import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  HOOKS_DIR,
  makeAuthedHome,
  makeRepo,
  startStubServer,
} from './helpers.mjs';

async function runStatus(t, httpStatus, responseBody) {
  const { repo } = makeRepo(t);
  const apiKey = 'sm_status_secret_0123456789';
  const home = makeAuthedHome(t, apiKey);
  const stub = await startStubServer(t, (record, res) => {
    if (httpStatus === 302 && record.url === '/v4/profile') {
      res.statusCode = 302;
      res.setHeader('Location', '/redirect-target');
      res.end();
      return;
    }
    const responseStatus = httpStatus === 302 ? 200 : httpStatus;
    res.statusCode = responseStatus;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      responseBody ??
        JSON.stringify(
          responseStatus === 200
            ? { profile: { static: [], dynamic: [] } }
            : { error: 'probe failed' },
        ),
    );
  });
  const sharedDir = join(home, '.codex', 'supermemory');
  mkdirSync(sharedDir, { recursive: true });
  writeFileSync(
    join(sharedDir, 'credentials.json'),
    JSON.stringify({ apiKey, apiBaseUrl: `${stub.url}/` }),
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
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { apiKey, output: JSON.parse(result.stdout), result, stub };
}

describe('status check', () => {
  test('uses the mirrored runtime transport without printing the key', async (t) => {
    const { apiKey, output, result, stub } = await runStatus(t, 200);

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(apiKey));
    assert.equal(output.authenticated, true);
    assert.equal(output.keySource, '~/.supermemory-claude/credentials.json');
    assert.equal(output.baseUrl, `${stub.url}/`);
    assert.equal(output.httpStatus, 200);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].url, '/v4/profile');
    assert.equal(stub.requests[0].headers.authorization, `Bearer ${apiKey}`);
  });

  test('separates rejected credentials from indeterminate failures', async (t) => {
    for (const [httpStatus, authenticated] of [
      [201, null],
      [204, null],
      [302, null],
      [401, false],
      [403, false],
      [429, null],
      [503, null],
    ]) {
      const { apiKey, output, result, stub } = await runStatus(t, httpStatus);
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, new RegExp(apiKey));
      assert.doesNotMatch(result.stderr, new RegExp(apiKey));
      assert.equal(output.authenticated, authenticated);
      assert.equal(output.httpStatus, httpStatus);
      if (httpStatus === 302) {
        assert.deepEqual(
          stub.requests.map((request) => request.url),
          ['/v4/profile'],
        );
      }
    }
  });

  test('preserves a direct 200 when the response body is malformed', async (t) => {
    const { apiKey, output, result, stub } = await runStatus(t, 200, '{');

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(apiKey));
    assert.doesNotMatch(result.stderr, new RegExp(apiKey));
    assert.equal(output.authenticated, true);
    assert.equal(output.httpStatus, 200);
    assert.deepEqual(
      stub.requests.map((request) => request.url),
      ['/v4/profile'],
    );
  });
});
