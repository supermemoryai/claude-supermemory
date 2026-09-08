import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  makeAuthedHome,
  makeRepo,
  plain,
  runHook,
  startStubServer,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const { readState } = require('../plugin/hooks/lib/statusline-state.js');

describe('session-start hook', () => {
  test('injects profile memories and announces the count', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const stub = await startStubServer(t, (_record, res) => {
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
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /Working on statusline/,
    );
    assert.match(
      plain(output.systemMessage),
      /◪ supermemory · 2 memories loaded for Example\.Project/,
    );
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
