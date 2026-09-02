import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
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

describe('container tags', () => {
  test('derives one canonical repo tag from the git remote', (t) => {
    const { repo, home } = makeRepo(t);
    const { tag, projectName } = readTags(repo, home);
    assert.equal(
      tag,
      `repo_example_project__${hash16('github.com/acme/example.project')}`,
    );
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
    const configDir = join(
      git(['rev-parse', '--show-toplevel']),
      '.claude',
      '.supermemory-claude',
    );
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ repoContainerTag: 'team_tag' }),
    );
    assert.equal(readTags(repo, home).tag, 'team_tag');
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
      assert.equal(
        plain(output.systemMessage),
        '◪ supermemory · recalling: auth flow decisions',
      );
    }
  });

  test('lets write tools and unrelated tools fall through to normal permissions', async (t) => {
    const home = makeTempDir(t, 'approve-home2');
    for (const toolName of [
      'mcp__supermemory__add_memory',
      'Bash',
      'mcp__other__search_memory',
    ]) {
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

describe('mcp proxy', () => {
  function runProxy(_t, env, lines) {
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
        resolve(
          stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l)),
        ),
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
    assert.deepEqual(
      messages.map((m) => m.id),
      [1, 2],
    );
    assert.match(stub.requests[0].headers.authorization, /^Bearer sm_test/);
    assert.equal(stub.requests[0].headers['mcp-session-id'], undefined);
    assert.equal(stub.requests[1].headers['mcp-session-id'], 'mcp-sess-9');
  });

  test('unwraps SSE responses into stdout lines', async (t) => {
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (record, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      const { id } = JSON.parse(record.body);
      res.end(
        `event: message\ndata: {"jsonrpc":"2.0","id":${id},"result":{"via":"sse"}}\n\n`,
      );
    });

    const messages = await runProxy(
      t,
      { HOME: home, USERPROFILE: home, SUPERMEMORY_MCP_URL: `${stub.url}/mcp` },
      [{ jsonrpc: '2.0', id: 7, method: 'tools/list' }],
    );
    assert.deepEqual(messages, [
      { jsonrpc: '2.0', id: 7, result: { via: 'sse' } },
    ]);
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
      writeState(
        '../../session-a',
        'context',
        { status: 'ready', memoryItemsLoaded: 4 },
        { dataDir, now: 1000 },
      ),
      true,
    );
    writeState(
      'session-a',
      'search',
      { results: 2, query: 'must not be stored' },
      { dataDir, now: 1100 },
    );
    writeState(
      'session-b',
      'context',
      { status: 'ready', memoryItemsLoaded: 9 },
      { dataDir, now: 1200 },
    );

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
      assert.equal(
        statSync(join(traversalDir, 'context.json')).mode & 0o777,
        0o600,
      );
    }
    assert.equal(
      readdirSync(traversalDir).some((name) => name.endsWith('.tmp')),
      false,
    );
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
    writeState(
      'stale-session',
      'context',
      { status: 'ready', memoryItemsLoaded: 1 },
      { dataDir },
    );
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
        {
          context,
          capture: { status: 'saved', count: 7, updatedAt: now + 10 },
        },
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
        {
          context,
          capture: { status: 'saving', count: 7, updatedAt: now + 15 },
        },
        now + 20,
      ),
      'saving session',
    );
    assert.equal(
      getStatusLabel(
        {
          context,
          capture: { status: 'saving', count: 7, updatedAt: now + 15 },
        },
        now + 15 + SAVING_TTL_MS,
      ),
      '3 loaded · 7 captured',
    );
    assert.equal(
      getStatusLabel(
        {
          context,
          capture: { status: 'error', count: 7, updatedAt: now + 15 },
        },
        now + 20,
      ),
      'session sync failed',
    );
    assert.equal(
      getStatusLabel(
        {
          context,
          capture: { status: 'error', count: 7, updatedAt: now + 15 },
        },
        now + 15 + ERROR_TTL_MS,
      ),
      '3 loaded · 7 captured',
    );
  });

  test('animates: no frame repeats within any 10s window', () => {
    const states = {
      saving: {
        context,
        capture: { status: 'saving', count: 2, updatedAt: now },
      },
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
      assert.equal(
        new Set(frames).size,
        frames.length,
        `${name} frames repeat`,
      );
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
    assert.ok(
      frames.some((f) => f.includes('7 captured')),
      'tally pane missing',
    );
    assert.ok(
      frames.some((f) => /saved \d+[smh] ago/.test(f)),
      'save age pane missing',
    );
    assert.ok(
      frames.some((f) => /recalled \d+[smh] ago/.test(f)),
      'recall age pane missing',
    );
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
    assert.equal(
      getStatusLabel({ context: { ...context, status: 'error' } }, now),
      null,
    );
    assert.equal(
      getStatusLabel({ context: { ...context, memoryItemsLoaded: 0 } }, now),
      'ready',
    );
  });
});
