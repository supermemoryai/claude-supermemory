import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  makeAuthedHome,
  makeRepo,
  makeTempDir,
  runHook,
  startStubServer,
} from './helpers.mjs';

const require = createRequire(import.meta.url);
const { readState } = require('../plugin/hooks/lib/statusline-state.js');

describe('capture hook', () => {
  test('uses the same-key mirrored Codex endpoint for writes', async (t) => {
    const { repo } = makeRepo(t);
    const apiKey = 'sm_test_key_0123456789abcdef';
    const home = makeAuthedHome(t, apiKey);
    const transcript = join(
      makeTempDir(t, 'mirrored-capture'),
      'session.jsonl',
    );
    writeFileSync(
      transcript,
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-02T08:00:00Z',
        message: { content: 'Remember the mirrored capture endpoint' },
      }),
    );
    const stub = await startStubServer(t, (_record, res) => {
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
      {
        session_id: 'sess-mirrored-capture',
        cwd: repo,
        transcript_path: transcript,
      },
      { HOME: home, USERPROFILE: home, SUPERMEMORY_API_URL: '' },
    );
    assert.equal(code, 0, stderr);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/v3/documents');
  });

  test('saves the transcript delta with scope metadata and entity context', async (t) => {
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const transcript = join(makeTempDir(t, 'transcript'), 'session.jsonl');
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-08-18T20:00:00Z',
          message: {
            content: 'Please fix the statusline symlink handling in the plugin',
          },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'a1',
          message: {
            content: [
              {
                type: 'text',
                text: 'Fixed: the symlink now re-points each session.',
              },
            ],
          },
        }),
      ].join('\n'),
    );
    const stub = await startStubServer(t, (_record, res) => {
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
    const { repo } = makeRepo(t);
    const home = makeAuthedHome(t);
    const transcript = join(
      makeTempDir(t, 'transcript-retry'),
      'session.jsonl',
    );
    writeFileSync(
      transcript,
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-08-18T20:00:00Z',
        message: {
          content: 'Remember: we chose Drizzle over Prisma for performance',
        },
      }),
    );
    let failing = true;
    const stub = await startStubServer(t, (_record, res) => {
      res.statusCode = failing ? 500 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(failing ? { error: 'boom' } : { id: 'doc_9' }));
    });
    const env = {
      HOME: home,
      USERPROFILE: home,
      SUPERMEMORY_API_URL: stub.url,
    };
    const input = {
      session_id: 'sess-retry',
      cwd: repo,
      transcript_path: transcript,
    };

    await runHook('capture.js', input, env);
    const dataDir = join(home, '.supermemory-claude', 'statusline');
    assert.equal(readState('sess-retry', { dataDir }).capture.status, 'error');

    failing = false;
    await runHook('capture.js', input, env);
    assert.equal(stub.requests.length, 2);
    assert.match(
      JSON.parse(stub.requests[1].body).content,
      /Drizzle over Prisma/,
    );
    assert.equal(readState('sess-retry', { dataDir }).capture.status, 'saved');

    await runHook('capture.js', input, env);
    assert.equal(stub.requests.length, 2);
  });
});
