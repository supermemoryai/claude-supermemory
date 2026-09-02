import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SESSION_RETENTION_MS,
  getSessionDir,
  pruneState,
  readState,
  writeState,
} = require('../plugin/hooks/lib/statusline-state.js');
const {
  ERROR_TTL_MS,
  SAVING_TTL_MS,
  TICK_MS,
  getStatusLabel,
  renderStatusline,
} = require('../plugin/statusline.js');
const {
  formatRecallContext,
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
} = require('../plugin/hooks/lib/context.js');
const { getProfiles } = require('../plugin/hooks/lib/api.js');

const HOOKS_DIR = join(process.cwd(), 'plugin', 'hooks');

function hash16(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// Banners and frames carry ANSI color and OSC-8 links; assertions compare plain text.
function plain(s) {
  return typeof s === 'string' ? s.replace(/\x1b(\[[0-9;]*m|\]8;;[^\x07]*\x07)/g, '') : s;
}

function makeTempDir(t, prefix) {
  const root = join(tmpdir(), `claude-sm-${prefix}-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeRepo(t, name = 'Example Project') {
  const root = join(tmpdir(), `claude-sm-${Date.now()}-${Math.random()}`);
  const repo = join(root, name);
  const home = join(root, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['remote', 'add', 'origin', 'git@github.com:acme/Example.Project.git']);
  writeFileSync(join(repo, 'README.md'), '# example\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { repo, git, home };
}

function readTags(cwd, home) {
  const modulePath = join(HOOKS_DIR, 'lib', 'container-tag.js');
  const script = `
    const tags = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify({
      tag: tags.getContainerTag(process.argv[1]),
      projectName: tags.getProjectName(process.argv[1]),
    }));
  `;
  const result = spawnSync('node', ['-e', script, cwd], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runHook(name, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(HOOKS_DIR, name)], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function startStubServer(t, handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const record = { method: req.method, url: req.url, headers: req.headers, body };
        requests.push(record);
        handler(record, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests });
    });
  });
}

function makeAuthedHome(t, apiKey = 'sm_test_key_0123456789abcdef') {
  const home = makeTempDir(t, 'home');
  mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
  writeFileSync(
    join(home, '.supermemory-claude', 'credentials.json'),
    JSON.stringify({ apiKey }),
  );
  return home;
}

function readSettings(home, apiKey = 'sm_shared') {
  const modulePath = join(HOOKS_DIR, 'lib', 'settings.js');
  const script = `
    const settings = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify({
      settings: settings.loadSettings(),
      signal: settings.getSignalConfig(process.cwd()),
      includeTools: settings.getIncludeTools(process.cwd()),
      baseUrl: settings.getBaseUrl(process.cwd(), null, ${JSON.stringify(apiKey)}),
    }));
  `;
  const result = spawnSync('node', ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
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
        { searchResults: { results: [{ memory: 'Use the shared\nsettings loader', similarity: 0.9 }] } },
        { searchResults: { results: [{ memory: 'Use the shared settings loader', similarity: 0.8 }] } },
      ],
      15,
    );
    assert.equal(merged.searchResults.results.length, 1);
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

describe('container tags', () => {
  test('derives one canonical repo tag from the git remote', (t) => {
    const { repo, home } = makeRepo(t);
    const { tag, projectName } = readTags(repo, home);
    assert.equal(tag, `repo_example_project__${hash16('github.com/acme/example.project')}`);
    assert.equal(projectName, 'Example.Project');
  });

  test('uses the shared git common root for linked worktrees', (t) => {
    const { repo, git, home } = makeRepo(t, 'repo');
    git(['add', 'README.md']);
    git(['commit', '-m', 'initial']);
    const worktree = join(repo, '..', 'worktree');
    git(['worktree', 'add', '--detach', worktree, 'HEAD']);
    assert.equal(readTags(worktree, home).tag, readTags(repo, home).tag);
  });

  test('honors the project-config override', (t) => {
    const { repo, git, home } = makeRepo(t);
    const configDir = join(git(['rev-parse', '--show-toplevel']), '.claude', '.supermemory-claude');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ repoContainerTag: 'team_tag' }));
    assert.equal(readTags(repo, home).tag, 'team_tag');
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

describe('stdin handling', () => {
  test('hooks finish even when stdin never emits end (issue #25)', async (t) => {
    const home = makeTempDir(t, 'stdin-home');
    const child = spawn('node', [join(HOOKS_DIR, 'recall-approve.js')], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.write(
      JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: {} }),
    );
    // stdin is deliberately left open — on Windows 'end' never fires.
    const stdout = await new Promise((resolve, reject) => {
      let out = '';
      const guard = setTimeout(() => {
        child.kill();
        reject(new Error('hook did not finish with stdin held open'));
      }, 5000);
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      child.on('close', () => {
        clearTimeout(guard);
        resolve(out);
      });
    });
    assert.equal(JSON.parse(stdout).continue, true);
  });
});

describe('recall-approve hook', () => {
  test('auto-approves read-only supermemory tools with a visible message', async (t) => {
    const home = makeTempDir(t, 'approve-home');
    for (const toolName of [
      'mcp__supermemory__search_memory',
      'mcp__plugin_supermemory_supermemory__search_memory',
      'mcp__claude_ai_supermemory__search_memory',
    ]) {
      const { stdout } = await runHook(
        'recall-approve.js',
        {
          session_id: 's1',
          tool_name: toolName,
          tool_input: { query: 'auth flow decisions' },
        },
        { HOME: home, USERPROFILE: home },
      );
      const output = JSON.parse(stdout);
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      assert.equal(plain(output.systemMessage), '◪ supermemory · recalling: auth flow decisions');
    }
  });

  test('lets write tools and unrelated tools fall through to normal permissions', async (t) => {
    const home = makeTempDir(t, 'approve-home2');
    for (const toolName of ['mcp__supermemory__add_memory', 'Bash', 'mcp__other__search_memory']) {
      const { stdout } = await runHook(
        'recall-approve.js',
        { session_id: 's1', tool_name: toolName, tool_input: {} },
        { HOME: home, USERPROFILE: home },
      );
      const output = JSON.parse(stdout);
      assert.equal(output.hookSpecificOutput, undefined);
      assert.equal(output.continue, true);
    }
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

describe('mcp proxy', () => {
  function runProxy(t, env, lines) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [join(HOOKS_DIR, 'mcp-proxy.js')], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.on('error', reject);
      child.on('close', () =>
        resolve(stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))),
      );
      for (const line of lines) child.stdin.write(`${JSON.stringify(line)}\n`);
      child.stdin.end();
    });
  }

  test('forwards requests with the stored key and tracks the MCP session', async (t) => {
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Mcp-Session-Id', 'mcp-sess-9');
      const { id } = JSON.parse(record.body);
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }));
    });

    const messages = await runProxy(
      t,
      { HOME: home, USERPROFILE: home, SUPERMEMORY_MCP_URL: `${stub.url}/mcp` },
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
    );
    assert.deepEqual(messages.map((m) => m.id), [1, 2]);
    assert.match(stub.requests[0].headers.authorization, /^Bearer sm_test/);
    assert.equal(stub.requests[0].headers['mcp-session-id'], undefined);
    assert.equal(stub.requests[1].headers['mcp-session-id'], 'mcp-sess-9');
  });

  test('unwraps SSE responses into stdout lines', async (t) => {
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      const { id } = JSON.parse(record.body);
      res.end(`event: message\ndata: {"jsonrpc":"2.0","id":${id},"result":{"via":"sse"}}\n\n`);
    });

    const messages = await runProxy(
      t,
      { HOME: home, USERPROFILE: home, SUPERMEMORY_MCP_URL: `${stub.url}/mcp` },
      [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }],
    );
    assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 7, result: { via: 'sse' } }]);
  });

  test('answers with a clear JSON-RPC error when unauthenticated', async (t) => {
    const home = makeTempDir(t, 'no-auth-home');
    const messages = await runProxy(
      t,
      {
        HOME: home,
        USERPROFILE: home,
        SUPERMEMORY_MCP_URL: 'http://127.0.0.1:1/mcp',
        SUPERMEMORY_CC_API_KEY: '',
      },
      [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }],
    );
    assert.equal(messages[0].error.code, -32001);
    assert.match(messages[0].error.message, /not authenticated/);
  });
});

describe('statusline state', () => {
  test('isolates sessions and writes private atomic event files', (t) => {
    const dataDir = makeTempDir(t, 'status-state');
    assert.equal(
      writeState('../../session-a', 'context', { status: 'ready', memoryItemsLoaded: 4 }, { dataDir, now: 1000 }),
      true,
    );
    writeState('session-a', 'search', { results: 2, query: 'must not be stored' }, { dataDir, now: 1100 });
    writeState('session-b', 'context', { status: 'ready', memoryItemsLoaded: 9 }, { dataDir, now: 1200 });

    const first = readState('../../session-a', { dataDir });
    const second = readState('session-b', { dataDir });
    assert.equal(first.context.memoryItemsLoaded, 4);
    assert.equal(first.search, null);
    assert.equal(second.context.memoryItemsLoaded, 9);
    assert.equal('query' in readState('session-a', { dataDir }).search, false);

    const traversalDir = getSessionDir('../../session-a', dataDir);
    assert.match(basename(traversalDir), /^[a-f0-9]{64}$/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(traversalDir).mode & 0o777, 0o700);
      assert.equal(statSync(join(traversalDir, 'context.json')).mode & 0o777, 0o600);
    }
    assert.equal(readdirSync(traversalDir).some((name) => name.endsWith('.tmp')), false);
  });

  test('ignores corrupt state without breaking the renderer', (t) => {
    const dataDir = makeTempDir(t, 'status-corrupt');
    const sessionDir = getSessionDir('session-a', dataDir);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'context.json'), '{broken');
    assert.deepEqual(readState('session-a', { dataDir }), {
      context: null,
      capture: null,
      search: null,
    });
    assert.equal(renderStatusline(readState('session-a', { dataDir })), '');
  });

  test('prunes only stale hashed session directories', (t) => {
    const dataDir = makeTempDir(t, 'status-prune');
    writeState('stale-session', 'context', { status: 'ready', memoryItemsLoaded: 1 }, { dataDir });
    const sessionDir = getSessionDir('stale-session', dataDir);
    utimesSync(join(sessionDir, 'context.json'), new Date(0), new Date(0));
    utimesSync(sessionDir, new Date(0), new Date(0));
    const unrelated = join(sessionDir, '..', 'do-not-delete');
    mkdirSync(unrelated);
    const activeSessionDir = getSessionDir('active-session', dataDir);
    mkdirSync(activeSessionDir);
    writeFileSync(join(activeSessionDir, '.context.tmp'), 'in progress');

    pruneState({ dataDir, now: SESSION_RETENTION_MS + 1 });
    assert.equal(existsSync(sessionDir), false);
    assert.equal(existsSync(unrelated), true);
    assert.equal(existsSync(activeSessionDir), true);
  });
});

describe('statusline rendering', () => {
  const now = 100_000;
  const context = {
    version: 1,
    event: 'context',
    status: 'ready',
    memoryItemsLoaded: 3,
    updatedAt: now,
  };

  test('rests on a live session tally that grows with activity', () => {
    assert.equal(getStatusLabel({ context }, now), '3 loaded');
    assert.equal(
      getStatusLabel(
        { context, capture: { status: 'saved', count: 7, updatedAt: now + 10 } },
        now + 20,
      ),
      '3 loaded · 7 captured',
    );
    assert.equal(
      getStatusLabel(
        {
          context,
          capture: { status: 'saved', count: 7, updatedAt: now + 10 },
          search: { results: 4, count: 2, updatedAt: now + 12 },
        },
        now + 20,
      ),
      '3 loaded · 7 captured · 2 recalls',
    );
    assert.equal(
      getStatusLabel(
        { context, search: { results: 4, count: 1, updatedAt: now + 12 } },
        now + 20,
      ),
      '3 loaded · 1 recall',
    );
    // With injected memories tracked, the tally counts memories, not events.
    assert.equal(
      getStatusLabel(
        {
          context,
          search: { results: 4, count: 2, memories: 9, updatedAt: now + 12 },
        },
        now + 20,
      ),
      '3 loaded · 9 recalled',
    );
    assert.equal(
      renderStatusline({ context }, { now, color: false }),
      '◪ supermemory · 3 loaded',
    );
    // Animation is presentation-only: the plain path is time-invariant.
    assert.equal(
      renderStatusline({ context }, { now: now + 7 * TICK_MS, color: false }),
      '◪ supermemory · 3 loaded',
    );
  });

  test('transient states briefly take over the tally', () => {
    assert.equal(
      getStatusLabel(
        { context, capture: { status: 'saving', count: 7, updatedAt: now + 15 } },
        now + 20,
      ),
      'saving session',
    );
    assert.equal(
      getStatusLabel(
        { context, capture: { status: 'saving', count: 7, updatedAt: now + 15 } },
        now + 15 + SAVING_TTL_MS,
      ),
      '3 loaded · 7 captured',
    );
    assert.equal(
      getStatusLabel(
        { context, capture: { status: 'error', count: 7, updatedAt: now + 15 } },
        now + 20,
      ),
      'session sync failed',
    );
    assert.equal(
      getStatusLabel(
        { context, capture: { status: 'error', count: 7, updatedAt: now + 15 } },
        now + 15 + ERROR_TTL_MS,
      ),
      '3 loaded · 7 captured',
    );
  });

  test('animates: no frame repeats within any 10s window', () => {
    const states = {
      saving: { context, capture: { status: 'saving', count: 2, updatedAt: now } },
      tally: {
        context,
        capture: { status: 'saved', count: 7, updatedAt: now + 10 },
        search: { results: 4, count: 2, updatedAt: now + 12 },
      },
      ready: { context: { ...context, memoryItemsLoaded: 0 } },
    };
    for (const [name, state] of Object.entries(states)) {
      const frames = Array.from({ length: 10 }, (_, i) =>
        renderStatusline(state, { now: now + 20 + i * TICK_MS }),
      );
      assert.equal(new Set(frames).size, frames.length, `${name} frames repeat`);
    }
  });

  test('rotates real content panes: tally, save age, recall age', () => {
    const state = {
      context,
      capture: { status: 'saved', count: 7, updatedAt: now + 10 },
      search: { results: 4, count: 2, updatedAt: now + 12 },
    };
    const frames = Array.from({ length: 12 }, (_, i) =>
      plain(renderStatusline(state, { now: now + 60_000 + i * TICK_MS })),
    );
    assert.ok(frames.some((f) => f.includes('7 captured')), 'tally pane missing');
    assert.ok(frames.some((f) => /saved \d+[smh] ago/.test(f)), 'save age pane missing');
    assert.ok(frames.some((f) => /recalled \d+[smh] ago/.test(f)), 'recall age pane missing');
  });

  test('suppresses counts from before the current session context', () => {
    assert.equal(
      getStatusLabel(
        {
          context,
          capture: { status: 'saved', count: 9, updatedAt: now - 1 },
          search: { results: 1, count: 3, updatedAt: now - 1 },
        },
        now + 10,
      ),
      '3 loaded',
    );
    assert.equal(getStatusLabel({ context: { ...context, status: 'error' } }, now), null);
    assert.equal(
      getStatusLabel({ context: { ...context, memoryItemsLoaded: 0 } }, now),
      'ready',
    );
  });
});
