import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  HOOKS_DIR,
  hash16,
  makeAuthedHome,
  makeRepo,
  makeTempDir,
  plain,
  runHook,
  startStubServer,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const {
  getSessionDir,
  readState,
} = require('../plugin/hooks/lib/statusline-state.js');
const {
  formatRecallContext,
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
} = require('../plugin/hooks/lib/context.js');
const { getProfiles } = require('../plugin/hooks/lib/api.js');

function runSettings(
  home,
  { apiKey = 'sm_shared', projectConfig = null, apiUrl = '' } = {},
) {
  const modulePath = join(HOOKS_DIR, 'lib', 'settings.js');
  const script = `
    const settings = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify({
      settings: settings.loadSettings(),
      signal: settings.getSignalConfig(process.cwd()),
      includeTools: settings.getIncludeTools(process.cwd()),
      baseUrl: settings.getBaseUrl(
        process.cwd(),
        ${JSON.stringify(projectConfig)},
        ${JSON.stringify(apiKey)},
      ),
    }));
  `;
  const result = spawnSync('node', ['-e', script], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SUPERMEMORY_API_URL: apiUrl,
    },
  });
  return {
    ...result,
    loaded: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

function readSettings(home, apiKey = 'sm_shared', options = {}) {
  const result = runSettings(home, { apiKey, ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.loaded;
}

describe('recall settings and merging', () => {
  test('shares only recall settings and applies Claude overrides', (t) => {
    const home = makeTempDir(t, 'settings');
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'supermemory.json'),
      JSON.stringify({
        maxMemories: 15,
        maxProfileItems: 15,
        maxRecallTokens: 5000,
        maxPromptRecallTokens: 2000,
        autoRecallContainers: true,
        customContainers: [
          { tag: 'coding_personal', description: 'Personal.' },
        ],
        debug: true,
        includeTools: ['Bash'],
        recallDirective: 'Codex-only directive',
        signalExtraction: true,
      }),
    );
    mkdirSync(join(home, '.codex', 'supermemory'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'supermemory', 'credentials.json'),
      JSON.stringify({
        apiKey: 'sm_shared',
        apiBaseUrl: 'http://127.0.0.1:6767',
      }),
    );
    writeFileSync(
      join(home, '.supermemory-claude', 'settings.json'),
      JSON.stringify({ maxMemories: 2 }),
    );

    const loaded = readSettings(home);
    assert.equal(loaded.settings.maxMemories, 2);
    assert.equal(loaded.settings.maxProfileItems, 15);
    assert.equal(loaded.settings.maxRecallTokens, 5000);
    assert.equal(loaded.settings.maxPromptRecallTokens, 2000);
    assert.equal(loaded.settings.autoRecallContainers, true);
    assert.equal(loaded.settings.debug, false);
    assert.equal(loaded.settings.recallDirective, null);
    assert.equal(loaded.signal.enabled, false);
    assert.deepEqual(loaded.includeTools, []);
    assert.equal(loaded.baseUrl, 'http://127.0.0.1:6767');
    assert.equal(
      readSettings(home, 'sm_other').baseUrl,
      'https://api.supermemory.ai',
    );
  });

  test('tolerates non-object shared JSON and redacts malformed credentials', (t) => {
    const home = makeTempDir(t, 'malformed-shared');
    const sharedDir = join(home, '.codex', 'supermemory');
    mkdirSync(sharedDir, { recursive: true });

    for (const value of [null, [], 'unrelated', 7]) {
      writeFileSync(
        join(home, '.codex', 'supermemory.json'),
        JSON.stringify(value),
      );
      writeFileSync(join(sharedDir, 'credentials.json'), JSON.stringify(value));
      const result = runSettings(home);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.loaded.settings.maxMemories, 5);
      assert.equal(result.loaded.baseUrl, 'https://api.supermemory.ai');
    }

    writeFileSync(
      join(home, '.codex', 'supermemory.json'),
      JSON.stringify({
        maxMemories: null,
        maxProfileItems: null,
        maxRecallTokens: null,
        maxPromptRecallTokens: null,
      }),
    );
    const loaded = readSettings(home).settings;
    assert.equal(loaded.maxMemories, 5);
    assert.equal(loaded.maxProfileItems, 5);
    assert.equal(loaded.maxRecallTokens, 2500);
    assert.equal(loaded.maxPromptRecallTokens, 500);

    const sentinel = 'sm_SECRET_MUST_NOT_REACH_STDERR';
    writeFileSync(join(sharedDir, 'credentials.json'), sentinel);
    const result = runSettings(home);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.loaded.baseUrl, 'https://api.supermemory.ai');
    assert.match(result.stderr, /Failed to load/);
    assert.doesNotMatch(result.stderr, new RegExp(sentinel));
  });

  test('keeps explicit endpoint precedence and ignores invalid mirrored URLs', (t) => {
    const home = makeTempDir(t, 'endpoint-precedence');
    const sharedDir = join(home, '.codex', 'supermemory');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, 'credentials.json'),
      JSON.stringify({
        apiKey: 'sm_shared',
        apiBaseUrl: 'http://127.0.0.1:6767',
      }),
    );

    assert.equal(
      readSettings(home, 'sm_shared', { apiUrl: 'http://127.0.0.1:7001' })
        .baseUrl,
      'http://127.0.0.1:7001',
    );
    assert.equal(
      readSettings(home, 'sm_shared', {
        projectConfig: { baseUrl: 'http://127.0.0.1:7002' },
      }).baseUrl,
      'http://127.0.0.1:7002',
    );

    writeFileSync(
      join(sharedDir, 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_shared', apiBaseUrl: 'not-a-url' }),
    );
    assert.equal(readSettings(home).baseUrl, 'https://api.supermemory.ai');
  });

  test('normalizes custom containers without requiring a description', (t) => {
    const home = makeTempDir(t, 'container-normalization');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'supermemory.json'),
      JSON.stringify({
        autoRecallContainers: true,
        customContainers: [
          { tag: ' coding_personal ', description: '' },
          { tag: ' copla_company ', description: ' Company knowledge. ' },
          { tag: '', description: 'invalid' },
          { tag: 'missing_description' },
        ],
      }),
    );

    const loaded = readSettings(home).settings;
    assert.deepEqual(loaded.customContainers, [
      { tag: 'coding_personal', description: '' },
      { tag: 'copla_company', description: 'Company knowledge.' },
    ]);
    assert.deepEqual(getRecallContainerTags('repo_test', loaded), [
      'repo_test',
      'coding_personal',
      'copla_company',
    ]);
  });

  test('keeps status and inspector descriptions aligned with automatic recall', () => {
    const status = readFileSync(
      join(process.cwd(), 'plugin', 'commands', 'status.md'),
      'utf8',
    );
    assert.match(status, /status-check\.js/);
    assert.doesNotMatch(status, /SUPERMEMORY_API_URL:-/);

    const inspector = readFileSync(
      join(process.cwd(), 'plugin-inspector.ts'),
      'utf8',
    );
    assert.doesNotMatch(inspector, /directiveSrc|id="directive"/);
    assert.match(inspector, /bounded automatic recall/);
    assert.doesNotMatch(inspector, /local, no network/);
  });

  test('requires a literal boolean to search custom containers', () => {
    const customContainers = [
      { tag: 'coding_personal', description: 'Personal.' },
    ];
    assert.deepEqual(
      getRecallContainerTags('repo_test', {
        autoRecallContainers: 'false',
        customContainers,
      }),
      ['repo_test'],
    );
    assert.deepEqual(
      getRecallContainerTags('repo_test', {
        autoRecallContainers: true,
        customContainers,
      }),
      ['repo_test', 'coding_personal'],
    );
  });

  test('dedupes whitespace-equivalent results before the global cap', () => {
    const merged = mergeProfileResults(
      [
        {
          searchResults: {
            results: [
              {
                memory: 'Use the shared settings loader',
                similarity: 0.8,
                title: 'lower',
              },
            ],
          },
        },
        {
          searchResults: {
            results: [
              {
                memory: 'Use the shared\nsettings loader',
                similarity: 0.9,
                title: 'higher',
              },
            ],
          },
        },
      ],
      15,
    );
    assert.equal(merged.searchResults.results.length, 1);
    assert.equal(merged.searchResults.results[0].similarity, 0.9);
    assert.equal(merged.searchResults.results[0].title, 'higher');
  });

  test('rejects finite negative relevance but keeps unscored results', () => {
    const merged = mergeProfileResults(
      [
        {
          searchResults: {
            results: [
              { memory: 'negative similarity', similarity: -0.5 },
              { memory: 'negative score', score: -0.25 },
              { memory: 'unscored result' },
            ],
          },
        },
      ],
      15,
    );
    assert.deepEqual(
      merged.searchResults.results.map((result) => result.memory),
      ['unscored result'],
    );
  });

  test('caps static and dynamic profile facts independently', () => {
    const merged = mergeProfileResults(
      [
        {
          profile: { static: ['s1', 's2', 's3'], dynamic: ['d1', 'd2', 'd3'] },
        },
      ],
      15,
    );
    const { newFacts } = formatSessionContext(merged, {
      maxProfileItems: 2,
      maxTokens: 1000,
      containerTag: 'repo_test',
      projectName: 'Test',
    });
    assert.deepEqual(newFacts, ['s1', 's2', 'd1', 'd2']);
  });

  test('keeps SessionStart wrappers complete at the whole-context budget', () => {
    const { text, newFacts } = formatSessionContext(
      { profile: { static: ['x'.repeat(4000)], dynamic: [] } },
      {
        maxProfileItems: 15,
        maxTokens: 120,
        containerTag: 'repo_test',
        projectName: 'Test',
      },
    );
    assert.ok(text.length <= 480);
    assert.match(text, /…/);
    assert.match(text, /<\/supermemory-context>$/);
    assert.equal(newFacts.length, 1);
  });

  test('surfaces a non-404 failure when every container request fails', async (t) => {
    const stub = await startStubServer(t, (record, res) => {
      const { containerTag } = JSON.parse(record.body);
      res.statusCode = containerTag === 'missing' ? 404 : 503;
      res.end(containerTag);
    });
    await assert.rejects(
      getProfiles(stub.url, 'sm_test', ['missing', 'unavailable']),
      (error) => error.status === 503,
    );
    await assert.rejects(
      getProfiles(stub.url, 'sm_test', ['missing']),
      (error) => error.status === 404,
    );
  });
});

describe('recall-directive hook', () => {
  test('searches with the prompt and injects the top matches', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (_record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          searchResults: {
            results: [
              { memory: 'Chose Drizzle over Prisma', similarity: 0.82 },
              {
                chunk: 'export const db = drizzle(client)',
                filepath: 'src/db.ts',
                similarity: 0.74,
              },
              { memory: 'Errors must be loud and obvious', similarity: 0.71 },
              {
                title: 'Migration plan',
                content: 'Use expand-contract migrations',
                similarity: 0.7,
              },
              { memory: 'irrelevant low-similarity hit', similarity: 0.2 },
            ],
          },
        }),
      );
    });

    const { code, stdout } = await runHook(
      'recall-directive.js',
      {
        session_id: 's1',
        cwd: repo,
        prompt: 'continue the database work from before',
      },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    assert.equal(code, 0);
    const output = JSON.parse(stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(context, /<supermemory-recall>/);
    assert.match(context, /- ◪ Chose Drizzle over Prisma/);
    assert.match(
      context,
      /- ◪ export const db = drizzle\(client\) \(src\/db\.ts\)/,
    );
    assert.match(context, /- ◪ Errors must be loud and obvious/);
    assert.match(
      context,
      /- ◪ Migration plan — Use expand-contract migrations/,
    );
    assert.doesNotMatch(context, /irrelevant low-similarity hit/);
    assert.match(context, /repo_example_project__/);
    assert.match(
      plain(output.systemMessage),
      /^◪ supermemory · recalled \d+ memories \(\d+ tok\)$/,
    );
    assert.equal(stub.requests[0].url, '/v4/profile');
    assert.equal(
      JSON.parse(stub.requests[0].body).q,
      'continue the database work from before',
    );

    const state = readState('s1', {
      dataDir: join(home, '.supermemory-claude', 'statusline'),
    });
    assert.equal(state.search.count, 1);
    assert.equal(state.search.results, 4);
    assert.equal(state.search.memories, 4);
  });

  test('mirrors shared Codex limits and globally ranks automatic containers', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'supermemory.json'),
      JSON.stringify({
        maxMemories: 15,
        maxPromptRecallTokens: 2000,
        autoRecallContainers: true,
        customContainers: [
          { tag: 'coding_personal', description: 'Personal coding decisions.' },
          { tag: 'copla_company', description: 'Company knowledge.' },
          { tag: 'unavailable', description: 'Temporarily unavailable.' },
        ],
      }),
    );
    const results = {
      coding_personal: Array.from({ length: 8 }, (_, index) => ({
        memory:
          index === 0
            ? 'Tomauskasz GitHub account preference'
            : `coding-${index}`,
        similarity: 0.99 - index / 100,
      })),
      copla_company: Array.from({ length: 8 }, (_, index) => ({
        memory: `Copla company knowledge workflow ${index}`,
        similarity: 0.985 - index / 100,
      })),
    };
    const stub = await startStubServer(t, (record, res) => {
      const { containerTag } = JSON.parse(record.body);
      if (containerTag === 'unavailable') {
        res.statusCode = 503;
        res.end('unavailable');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          searchResults: {
            results:
              results[containerTag] ||
              Array.from({ length: 8 }, (_, index) => ({
                memory: `repo-${index}`,
                similarity: 0.97 - index / 100,
              })),
          },
        }),
      );
    });

    const { stdout } = await runHook(
      'recall-directive.js',
      {
        session_id: 's-shared-config',
        cwd: repo,
        prompt:
          'recall personal GitHub preferences and Copla company workflows',
      },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    const tags = stub.requests.map(
      (request) => JSON.parse(request.body).containerTag,
    );
    assert.deepEqual(
      new Set(tags),
      new Set([
        `repo_example_project__${hash16('github.com/acme/example.project')}`,
        'coding_personal',
        'copla_company',
        'unavailable',
      ]),
    );
    assert.equal((context.match(/^- ◪ /gm) || []).length, 15);
    assert.ok(context.indexOf('Tomauskasz') < context.indexOf('repo-0'));
    assert.match(context, /Copla company knowledge workflow/);
    assert.match(context, /Configured automatic recall containers:/);
    assert.ok(context.length <= 8000);
    assert.match(context, /<\/supermemory-recall>$/);
  });

  test('preserves complete recall wrappers at the token budget', () => {
    const { text, newFacts } = formatRecallContext(
      [
        {
          memory: 'short memory',
          title: 't'.repeat(4000),
          filepath: 'p'.repeat(4000),
        },
      ],
      {
        containerTag: 'repo_test',
        maxTokens: 200,
        customContainers: [
          { tag: 'coding_personal', description: 'd'.repeat(4000) },
        ],
      },
    );
    assert.ok(text.length <= 800);
    assert.match(text, /short memory/);
    assert.match(text, /…/);
    assert.match(text, /<\/supermemory-recall>$/);
    assert.equal(newFacts.length, 1);
  });

  test('does not count a prefix-only truncated memory as emitted', () => {
    const options = {
      containerTag: 'repo_test',
      customContainers: [],
    };
    let minimumTokens = null;
    for (let tokens = 0.25; tokens < 500; tokens += 0.25) {
      try {
        formatRecallContext([], { ...options, maxTokens: tokens });
        minimumTokens = tokens;
        break;
      } catch {}
    }
    assert.notEqual(minimumTokens, null);

    const result = formatRecallContext([{ memory: 'must remain eligible' }], {
      ...options,
      maxTokens: minimumTokens + 0.5,
    });
    assert.equal(result.text, '');
    assert.deepEqual(result.newFacts, []);
  });

  test('budgets the automatic-container catalog as variable context', () => {
    const { text, newFacts } = formatRecallContext(
      [{ memory: 'short memory' }],
      {
        containerTag: 'repo_test',
        maxTokens: 200,
        customContainers: [
          { tag: 'coding_personal', description: 'd'.repeat(4000) },
        ],
      },
    );
    assert.ok(text.length <= 800);
    assert.match(text, /short memory/);
    assert.match(text, /Configured automatic recall containers:/);
    assert.match(text, /…/);
    assert.match(text, /<\/supermemory-recall>$/);
    assert.equal(newFacts.length, 1);
  });

  test('keeps the compatibility prompt budget when settings are absent', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (_record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          searchResults: {
            results: Array.from({ length: 5 }, (_, index) => ({
              memory: `${index}:${'x'.repeat(4000)}`,
              similarity: 0.9 - index / 100,
            })),
          },
        }),
      );
    });

    const { stdout } = await runHook(
      'recall-directive.js',
      {
        session_id: 's-default-budget',
        cwd: repo,
        prompt: 'recall the previous implementation',
      },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert.ok(context.length <= 2000);
    assert.match(context, /<\/supermemory-recall>$/);
  });

  test('persists only the emitted fragment of a truncated memory', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    writeFileSync(
      join(home, '.supermemory-claude', 'settings.json'),
      JSON.stringify({ maxMemories: 3, maxPromptRecallTokens: 150 }),
    );
    const hits = ['A', 'B', 'C'].map((prefix, index) => ({
      memory: `${prefix}:${prefix.repeat(1000)}`,
      similarity: 0.9 - index / 100,
    }));
    const stub = await startStubServer(t, (_record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ searchResults: { results: hits } }));
    });
    const input = {
      session_id: 's-emitted-only',
      cwd: repo,
      prompt: 'recall the long ordered memories',
    };
    const env = {
      HOME: home,
      USERPROFILE: home,
      SUPERMEMORY_API_URL: stub.url,
    };

    const formatted = formatRecallContext(hits, {
      containerTag: 'repo_example_project',
      customContainers: [],
      maxTokens: 150,
    });
    assert.equal(formatted.newFacts.length, 1);
    assert.match(formatted.newFacts[0], /^A:A+…$/);
    assert.notEqual(formatted.newFacts[0], hits[0].memory);

    const first = JSON.parse(
      (await runHook('recall-directive.js', input, env)).stdout,
    );
    assert.match(first.hookSpecificOutput.additionalContext, /A:AAA/);
    assert.doesNotMatch(first.hookSpecificOutput.additionalContext, /B:BBB/);

    const sessionDir = getSessionDir(
      input.session_id,
      join(home, '.supermemory-claude', 'statusline'),
    );
    const seen = JSON.parse(
      readFileSync(join(sessionDir, 'recalled.json'), 'utf8'),
    );
    assert.ok(seen.includes(hash16(formatted.newFacts[0].toLowerCase())));
    assert.ok(!seen.includes(hash16(hits[0].memory.toLowerCase())));

    const second = JSON.parse(
      (await runHook('recall-directive.js', input, env)).stdout,
    );
    assert.match(second.hookSpecificOutput.additionalContext, /A:AAA/);
  });

  test('does not persist a prefix-only memory as seen', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const formatterOptions = {
      containerTag: 'repo_test',
      customContainers: [],
    };
    let minimumTokens = null;
    for (let tokens = 0.25; tokens < 500; tokens += 0.25) {
      try {
        formatRecallContext([], { ...formatterOptions, maxTokens: tokens });
        minimumTokens = tokens;
        break;
      } catch {}
    }
    assert.notEqual(minimumTokens, null);
    writeFileSync(
      join(home, '.supermemory-claude', 'settings.json'),
      JSON.stringify({ maxPromptRecallTokens: minimumTokens + 0.5 }),
    );
    const stub = await startStubServer(t, (_record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          searchResults: {
            results: [{ memory: 'must remain eligible', similarity: 0.9 }],
          },
        }),
      );
    });
    const input = {
      session_id: 's-prefix-only',
      cwd: repo,
      prompt: 'recall the still eligible memory',
    };
    const env = {
      HOME: home,
      USERPROFILE: home,
      SUPERMEMORY_API_URL: stub.url,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const output = JSON.parse(
        (await runHook('recall-directive.js', input, env)).stdout,
      );
      assert.equal(output.hookSpecificOutput, undefined);
    }
    const sessionDir = getSessionDir(
      input.session_id,
      join(home, '.supermemory-claude', 'statusline'),
    );
    assert.equal(existsSync(join(sessionDir, 'recalled.json')), false);
    assert.equal(stub.requests.length, 2);
  });

  test('skips trivial prompts and slash commands without an API call', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (_record, res) => res.end('{}'));
    for (const prompt of ['hi', '/supermemory:status', '!ls', undefined]) {
      const { stdout } = await runHook(
        'recall-directive.js',
        { session_id: 's1', cwd: repo, prompt },
        { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
      );
      assert.equal(JSON.parse(stdout).hookSpecificOutput, undefined);
    }
    assert.equal(stub.requests.length, 0);
  });

  test('dedupes across the session: repeats go silent, mixes are labeled', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    let hits = [
      { memory: 'Chose Drizzle over Prisma', similarity: 0.82 },
      { memory: 'Errors must be loud and obvious', similarity: 0.71 },
    ];
    const stub = await startStubServer(t, (_record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ searchResults: { results: hits } }));
    });
    const env = {
      HOME: home,
      USERPROFILE: home,
      SUPERMEMORY_API_URL: stub.url,
    };
    const input = {
      session_id: 's-dedup',
      cwd: repo,
      prompt: 'continue the database work',
    };

    const first = JSON.parse(
      (await runHook('recall-directive.js', input, env)).stdout,
    );
    assert.match(
      plain(first.systemMessage),
      /^◪ supermemory · recalled 2 memories \(\d+ tok\)$/,
    );

    const second = JSON.parse(
      (await runHook('recall-directive.js', input, env)).stdout,
    );
    assert.equal(second.systemMessage, undefined);
    assert.equal(second.hookSpecificOutput, undefined);

    hits = [...hits, { memory: 'New fact about migrations', similarity: 0.8 }];
    const third = JSON.parse(
      (await runHook('recall-directive.js', input, env)).stdout,
    );
    assert.match(
      plain(third.systemMessage),
      /^◪ supermemory · recalled 1 new \(\d+ tok\) · 2 already in context$/,
    );
    assert.match(
      third.hookSpecificOutput.additionalContext,
      /New fact about migrations/,
    );
    assert.doesNotMatch(
      third.hookSpecificOutput.additionalContext,
      /Chose Drizzle over Prisma/,
    );

    const state = readState('s-dedup', {
      dataDir: join(home, '.supermemory-claude', 'statusline'),
    });
    assert.equal(state.search.count, 3);
    assert.equal(state.search.results, 1);
    assert.equal(state.search.memories, 3);
  });

  test('a configured recallDirective restores advisory mode verbatim', async (t) => {
    const { repo, git, home } = makeRepo(t);
    const configDir = join(
      git(['rev-parse', '--show-toplevel']),
      '.claude',
      '.supermemory-claude',
    );
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ recallDirective: 'CUSTOM DIRECTIVE' }),
    );
    const { stdout } = await runHook(
      'recall-directive.js',
      { session_id: 's1', cwd: repo, prompt: 'a long substantive prompt here' },
      { HOME: home, USERPROFILE: home },
    );
    assert.equal(
      JSON.parse(stdout).hookSpecificOutput.additionalContext,
      'CUSTOM DIRECTIVE',
    );
  });
});
