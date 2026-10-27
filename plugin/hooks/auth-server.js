const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AUTH_BASE_URL,
  AUTH_PORT,
  AUTH_WAIT_MS,
  openUrl,
  saveCredentials,
} = require('./lib/auth');

const authSuccessHtml = fs.readFileSync(
  path.join(__dirname, 'templates/auth-success.html'),
  'utf-8',
);
const authErrorHtml = fs.readFileSync(
  path.join(__dirname, 'templates/auth-error.html'),
  'utf-8',
);

const EXPIRES_MARGIN_MS = 15000;
const TOKEN_FILE = path.join(
  os.homedir(),
  '.supermemory-claude',
  'auth-server-token',
);

function readPreviousToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

function writeToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
}

function stopPreviousServer() {
  const state = encodeURIComponent(readPreviousToken());
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${AUTH_PORT}/stop?state=${state}`,
      { timeout: 1000 },
      (res) => {
        res.resume();
        res.on('end', () => setTimeout(() => resolve(res.statusCode), 200));
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(AUTH_PORT, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function main() {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);
    const guarded = url.pathname === '/callback' || url.pathname === '/stop';

    if (guarded && url.searchParams.get('state') !== token) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(authErrorHtml);
    } else if (url.pathname === '/callback') {
      const apiKey =
        url.searchParams.get('apikey') || url.searchParams.get('api_key');
      if (apiKey?.startsWith('sm_')) {
        saveCredentials(apiKey);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(authSuccessHtml, () => process.exit(0));
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(authErrorHtml);
      }
    } else if (url.pathname === '/stop') {
      res.writeHead(200);
      res.end('stopping', () => process.exit(0));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  try {
    await listen(server);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') process.exit(1);
    const stopStatus = await stopPreviousServer();
    await listen(server).catch(() => process.exit(stopStatus === 403 ? 0 : 1));
  }
  writeToken(token);

  const expires = Date.now() + AUTH_WAIT_MS - EXPIRES_MARGIN_MS;
  const callbackUrl = `http://localhost:${AUTH_PORT}/callback?state=${token}`;
  const params = new URLSearchParams({
    callback: callbackUrl,
    client: 'claude_code',
    expires: String(expires),
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
  });
  const authUrl = `${AUTH_BASE_URL}?${params}`;
  await openUrl(authUrl);

  setTimeout(() => process.exit(0), AUTH_WAIT_MS);
}

main().catch(() => process.exit(1));
