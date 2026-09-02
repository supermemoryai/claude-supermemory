import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
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
const { getSessionDir, readState } = require('../plugin/hooks/lib/statusline-state.js');
const {
  formatRecallContext,
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
} = require('../plugin/hooks/lib/context.js');
const { getProfiles } = require('../plugin/hooks/lib/api.js');

function runSettings(home, { apiKey = 'sm_shared', projectConfig = null, apiUrl = '' } = {}) {
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
        customContainers: [{ tag: 'coding_personal', description: 'Personal.' }],
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
    assert.equal(readSettings(home, 'sm_other').baseUrl, 'https://api.supermemory.ai');
  });

  test('tolerates non-object shared JSON and redacts malformed credentials', (t) => {
    const home = makeTempDir(t, 'malformed-shared');
    const sharedDir = join(home, '.codex', 'supermemory');
    mkdirSync(sharedDir, { recursive: true });

    for (const value of [null, [], 'unrelated', 7]) {
      writeFileSync(join(home, '.codex', 'supermemory.json'), JSON.stringify(value));
      writeFileSync(join(sharedDir, 'credentials.json'), JSON.stringify(value));
      const result = runSettings(home);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.loaded.settings.maxMemories, 5);
      assert.equal(result.loaded.baseUrl, 'https://api.supermemory.ai');
    }

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
      JSON.stringify({ apiKey: 'sm_shared', apiBaseUrl: 'http://127.0.0.1:6767' }),
    );

    assert.equal(
      readSettings(home, 'sm_shared', { apiUrl: 'http://127.0.0.1:7001' }).baseUrl,
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
    const customContainers = [{ tag: 'coding_personal', description: 'Personal.' }];
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
        { searchResults: { results: [{ memory: 'Use the shared settings loader', similarity: 0.8, title: 'lower' }] } },
        { searchResults: { results: [{ memory: 'Use the shared\nsettings loader', similarity: 0.9, title: 'higher' }] } },
      ],
      15,
    );
    assert.equal(merged.searchResults.results.length, 1);
    assert.equal(merged.searchResults.results[0].similarity, 0.9);
    assert.equal(merged.searchResults.results[0].title, 'higher');
  });

  test('caps static and dynamic profile facts independently', () => {
    const merged = mergeProfileResults(
      [{ profile: { static: ['s1', 's2', 's3'], dynamic: ['d1', 'd2', 'd3'] } }],
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
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          searchResults: {
            results: [
              { memory: 'Chose Drizzle over Prisma', similarity: 0.82 },
              { chunk: 'export const db = drizzle(client)', filepath: 'src/db.ts', similarity: 0.74 },
              { memory: 'Errors must be loud and obvious', similarity: 0.71 },
              { title: 'Migration plan', content: 'Use expand-contract migrations', similarity: 0.7 },
              { memory: 'irrelevant low-similarity hit', similarity: 0.2 },
            ],
          },
        }),
      );
    });

    const { code, stdout } = await runHook(
      'recall-directive.js',
      { session_id: 's1', cwd: repo, prompt: 'continue the database work from before' },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    assert.equal(code, 0);
    const output = JSON.parse(stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(context, /<supermemory-recall>/);
    assert.match(context, /- ◪ Chose Drizzle over Prisma/);
    assert.match(context, /- ◪ export const db = drizzle\(client\) \(src\/db\.ts\)/);
    assert.match(context, /- ◪ Errors must be loud and obvious/);
    assert.match(context, /- ◪ Migration plan — Use expand-contract migrations/);
    assert.doesNotMatch(context, /irrelevant low-similarity hit/);
    assert.match(context, /repo_example_project__/);
    assert.match(plain(output.systemMessage), /^◪ supermemory · recalled \d+ memories \(\d+ tok\)$/);
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
        memory: index === 0 ? 'Tomauskasz GitHub account preference' : `coding-${index}`,
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
        prompt: 'recall personal GitHub preferences and Copla company workflows',
      },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    const tags = stub.requests.map((request) => JSON.parse(request.body).containerTag);
    assert.deepEqual(new Set(tags), new Set([
      `repo_example_project__${hash16('github.com/acme/example.project')}`,
      'coding_personal',
      'copla_company',
      'unavailable',
    ]));
    assert.equal((context.match(/^- ◪ /gm) || []).length, 15);
    assert.ok(context.indexOf('Tomauskasz') < context.indexOf('repo-0'));
    assert.match(context, /Copla company knowledge workflow/);
    assert.match(context, /Configured automatic recall containers:/);
    assert.ok(context.length <= 8000);
    assert.match(context, /<\/supermemory-recall>$/);
  });

  test('preserves complete recall wrappers at the token budget', () => {
    const { text, newFacts } = formatRecallContext(
      [{
        memory: 'short memory',
        title: 't'.repeat(4000),
        filepath: 'p'.repeat(4000),
      }],
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

    const result = formatRecallContext(
      [{ memory: 'must remain eligible' }],
      { ...options, maxTokens: minimumTokens + 0.5 },
    );
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
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        searchResults: {
          results: Array.from({ length: 5 }, (_, index) => ({
            memory: `${index}:${'x'.repeat(4000)}`,
            similarity: 0.9 - index / 100,
          })),
        },
      }));
    });

    const { stdout } = await runHook(
      'recall-directive.js',
      { session_id: 's-default-budget', cwd: repo, prompt: 'recall the previous implementation' },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    const context = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    assert.ok(context.length <= 2000);
    assert.match(context, /<\/supermemory-recall>$/);
  });

  test('marks only memories emitted within the prompt budget as seen', async (t) => {
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
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ searchResults: { results: hits } }));
    });
    const input = {
      session_id: 's-emitted-only',
      cwd: repo,
      prompt: 'recall the long ordered memories',
    };
    const env = { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url };

    const first = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
    assert.match(first.hookSpecificOutput.additionalContext, /A:AAA/);
    assert.doesNotMatch(first.hookSpecificOutput.additionalContext, /B:BBB/);

    const second = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
    assert.match(second.hookSpecificOutput.additionalContext, /B:BBB/);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /A:AAA/);
  });

  test('does not persist a prefix-only memory as seen', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const formatterOptions = { containerTag: 'repo_test', customContainers: [] };
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
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        searchResults: {
          results: [{ memory: 'must remain eligible', similarity: 0.9 }],
        },
      }));
    });
    const input = {
      session_id: 's-prefix-only',
      cwd: repo,
      prompt: 'recall the still eligible memory',
    };
    const env = { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const output = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
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
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    const stub = await startStubServer(t, (record, res) => res.end('{}'));
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
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    let hits = [
      { memory: 'Chose Drizzle over Prisma', similarity: 0.82 },
      { memory: 'Errors must be loud and obvious', similarity: 0.71 },
    ];
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ searchResults: { results: hits } }));
    });
    const env = { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url };
    const input = { session_id: 's-dedup', cwd: repo, prompt: 'continue the database work' };

    const first = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
    assert.match(plain(first.systemMessage), /^◪ supermemory · recalled 2 memories \(\d+ tok\)$/);

    const second = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
    assert.equal(second.systemMessage, undefined);
    assert.equal(second.hookSpecificOutput, undefined);

    hits = [...hits, { memory: 'New fact about migrations', similarity: 0.8 }];
    const third = JSON.parse((await runHook('recall-directive.js', input, env)).stdout);
    assert.match(plain(third.systemMessage), /^◪ supermemory · recalled 1 new \(\d+ tok\) · 2 already in context$/);
    assert.match(third.hookSpecificOutput.additionalContext, /New fact about migrations/);
    assert.doesNotMatch(third.hookSpecificOutput.additionalContext, /Chose Drizzle over Prisma/);

    const state = readState('s-dedup', {
      dataDir: join(home, '.supermemory-claude', 'statusline'),
    });
    assert.equal(state.search.count, 3);
    assert.equal(state.search.results, 1);
    assert.equal(state.search.memories, 3);
  });

  test('a configured recallDirective restores advisory mode verbatim', async (t) => {
    const { repo, git, home } = makeRepo(t);
    const configDir = join(git(['rev-parse', '--show-toplevel']), '.claude', '.supermemory-claude');
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
    assert.equal(JSON.parse(stdout).hookSpecificOutput.additionalContext, 'CUSTOM DIRECTIVE');
  });
});

describe('status check', () => {
  test('probes the same-key mirrored endpoint without printing the key', async (t) => {
    const { repo } = makeRepo(t);
    const apiKey = 'sm_status_secret_0123456789';
    const home = makeAuthedHome(t, apiKey);
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ profile: { static: [], dynamic: [] } }));
    });
    const sharedDir = join(home, '.codex', 'supermemory');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, 'credentials.json'),
      JSON.stringify({ apiKey, apiBaseUrl: stub.url }),
    );

    const result = await new Promise((resolve, reject) => {
      const child = spawn('node', [join(HOOKS_DIR, 'status-check.js')], {
        cwd: repo,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          SUPERMEMORY_API_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(apiKey));
    const output = JSON.parse(result.stdout);
    assert.equal(output.authenticated, true);
    assert.equal(output.keySource, '~/.supermemory-claude/credentials.json');
    assert.equal(output.baseUrl, stub.url);
    assert.equal(output.httpStatus, 200);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/v4/profile');
    assert.equal(stub.requests[0].headers.authorization, `Bearer ${apiKey}`);
  });
});

describe('session-start hook', () => {
  test('injects profile memories and announces the count', async (t) => {
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          profile: { static: ['Uses Bun'], dynamic: ['Working on statusline'] },
        }),
      );
    });

    const { code, stdout } = await runHook(
      'session-start.js',
      { session_id: 'sess-1', cwd: repo },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    assert.equal(code, 0);
    const output = JSON.parse(stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /Uses Bun/);
    assert.match(output.hookSpecificOutput.additionalContext, /Working on statusline/);
    assert.match(plain(output.systemMessage), /◪ supermemory · 2 memories loaded for Example\.Project/);
    assert.equal(stub.requests[0].url, '/v4/profile');
    assert.match(stub.requests[0].headers.authorization, /^Bearer sm_test/);

    const state = readState('sess-1', {
      dataDir: join(home, '.supermemory-claude', 'statusline'),
    });
    assert.equal(state.context.status, 'ready');
    assert.equal(state.context.memoryItemsLoaded, 2);
  });

  test('loads profile facts from shared automatic containers', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'supermemory.json'),
      JSON.stringify({
        maxProfileItems: 15,
        maxRecallTokens: 5000,
        autoRecallContainers: true,
        customContainers: [
          { tag: 'coding_personal', description: 'Personal coding decisions.' },
          { tag: 'copla_company', description: 'Company knowledge.' },
        ],
      }),
    );
    const stub = await startStubServer(t, (record, res) => {
      const { containerTag } = JSON.parse(record.body);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          profile: {
            static: [`static:${containerTag}`],
            dynamic: [`dynamic:${containerTag}`],
          },
        }),
      );
    });

    const { stdout } = await runHook(
      'session-start.js',
      { session_id: 'sess-shared-config', cwd: repo },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    const output = JSON.parse(stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.equal(stub.requests.length, 3);
    assert.match(context, /static:coding_personal/);
    assert.match(context, /dynamic:copla_company/);
    assert.ok(context.length <= 20000);
    assert.match(context, /<\/supermemory-context>$/);
    assert.match(plain(output.systemMessage), /6 memories loaded/);
  });
});

describe('capture hook', () => {
  test('uses the same-key mirrored Codex endpoint for writes', async (t) => {
    const { repo } = makeRepo(t);
    const apiKey = 'sm_test_key_0123456789abcdef';
    const home = makeAuthedHome(t, apiKey);
    const transcript = join(makeTempDir(t, 'mirrored-capture'), 'session.jsonl');
    writeFileSync(
      transcript,
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-02T08:00:00Z',
        message: { content: 'Remember the mirrored capture endpoint' },
      }),
    );
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'doc_mirrored', status: 'queued' }));
    });
    const sharedDir = join(home, '.codex', 'supermemory');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, 'credentials.json'),
      JSON.stringify({ apiKey, apiBaseUrl: stub.url }),
    );

    const { code, stderr } = await runHook(
      'capture.js',
      { session_id: 'sess-mirrored-capture', cwd: repo, transcript_path: transcript },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: '' },
    );
    assert.equal(code, 0, stderr);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/v3/documents');
  });

  test('saves the transcript delta with scope metadata and entity context', async (t) => {
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    const transcript = join(makeTempDir(t, 'transcript'), 'session.jsonl');
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-08-18T20:00:00Z',
          message: { content: 'Please fix the statusline symlink handling in the plugin' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'a1',
          message: {
            content: [{ type: 'text', text: 'Fixed: the symlink now re-points each session.' }],
          },
        }),
      ].join('\n'),
    );
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'doc_123', status: 'queued' }));
    });

    const { code } = await runHook(
      'capture.js',
      { session_id: 'sess-2', cwd: repo, transcript_path: transcript },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url },
    );
    assert.equal(code, 0);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/v3/documents');
    const body = JSON.parse(stub.requests[0].body);
    assert.match(body.content, /statusline symlink/);
    assert.match(body.containerTag, /^repo_example_project__/);
    assert.equal(body.metadata.sm_scope, 'personal');
    assert.equal(body.customId, 'sess-2');
    assert.match(body.entityContext, /EXTRACT/);

    const state = readState('sess-2', {
      dataDir: join(home, '.supermemory-claude', 'statusline'),
    });
    assert.equal(state.capture.status, 'saved');
  });

  test('a failed save does not advance the cursor; the retry recaptures (issue #96)', async (t) => {
    const { repo, home } = makeRepo(t);
    mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
    writeFileSync(
      join(home, '.supermemory-claude', 'credentials.json'),
      JSON.stringify({ apiKey: 'sm_test_key_0123456789abcdef' }),
    );
    const transcript = join(makeTempDir(t, 'transcript-retry'), 'session.jsonl');
    writeFileSync(
      transcript,
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-08-18T20:00:00Z',
        message: { content: 'Remember: we chose Drizzle over Prisma for performance' },
      }),
    );
    let failing = true;
    const stub = await startStubServer(t, (record, res) => {
      res.statusCode = failing ? 500 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(failing ? { error: 'boom' } : { id: 'doc_9' }));
    });
    const env = { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: stub.url };
    const input = { session_id: 'sess-retry', cwd: repo, transcript_path: transcript };

    await runHook('capture.js', input, env);
    const dataDir = join(home, '.supermemory-claude', 'statusline');
    assert.equal(readState('sess-retry', { dataDir }).capture.status, 'error');

    failing = false;
    await runHook('capture.js', input, env);
    assert.equal(stub.requests.length, 2);
    assert.match(JSON.parse(stub.requests[1].body).content, /Drizzle over Prisma/);
    assert.equal(readState('sess-retry', { dataDir }).capture.status, 'saved');

    // Cursor advanced after success: a third run finds nothing new.
    await runHook('capture.js', input, env);
    assert.equal(stub.requests.length, 2);
  });
});

