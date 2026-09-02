import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const HOOKS_DIR = join(process.cwd(), 'plugin', 'hooks');

export function hash16(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function plain(value) {
  return typeof value === 'string'
    ? // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI and OSC escapes are the input.
      value.replace(/\x1b(\[[0-9;]*m|\]8;;[^\x07]*\x07)/g, '')
    : value;
}

export function makeTempDir(t, prefix) {
  const root = join(
    tmpdir(),
    `claude-sm-${prefix}-${Date.now()}-${Math.random()}`,
  );
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function makeRepo(t, name = 'Example Project') {
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

export function runHook(name, input, env = {}) {
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

export function startStubServer(t, handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const record = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        };
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

export function makeAuthedHome(t, apiKey = 'sm_test_key_0123456789abcdef') {
  const home = makeTempDir(t, 'home');
  mkdirSync(join(home, '.supermemory-claude'), { recursive: true });
  writeFileSync(
    join(home, '.supermemory-claude', 'credentials.json'),
    JSON.stringify({ apiKey }),
  );
  return home;
}
