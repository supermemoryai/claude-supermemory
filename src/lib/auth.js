const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const authSuccessHtml = require('../templates/auth-success.html');
const authErrorHtml = require('../templates/auth-error.html');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

const AUTH_BASE_URL =
  process.env.SUPERMEMORY_AUTH_URL ||
  'https://console.supermemory.ai/auth/agent-connect';
const AUTH_TIMEOUT = Number(process.env.SUPERMEMORY_AUTH_TIMEOUT) || 60000;

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
      if (data.apiKey) return data;
    }
  } catch {}
  return null;
}

function saveCredentials(apiKey) {
  ensureDir();
  const data = {
    apiKey,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
}

function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {}
}

function openBrowser(url) {
  const onError = (err) => {
    if (err) console.warn('Failed to open browser:', err.message);
  };
  if (process.platform === 'win32') {
    execFile('explorer.exe', [url], onError);
  } else if (process.platform === 'darwin') {
    execFile('open', [url], onError);
  } else {
    execFile('xdg-open', [url], onError);
  }
}

function startAuthFlow() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const stateToken = randomBytes(16).toString('hex');

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/callback') {
        const callbackState = url.searchParams.get('state');
        if (callbackState !== stateToken) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end(authErrorHtml);
          return;
        }

        const apiKey =
          url.searchParams.get('apikey') || url.searchParams.get('api_key');

        if (apiKey?.startsWith('sm_')) {
          saveCredentials(apiKey);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(authSuccessHtml);
          resolved = true;
          clearTimeout(timer);
          server.close();
          resolve(apiKey);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(authErrorHtml);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Listen on an ephemeral port; embed state token in callback URL so the
    // console redirects it back and the CSRF check passes.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const callbackUrl = `http://localhost:${port}/callback?state=${stateToken}`;
      const params = new URLSearchParams({
        callback: callbackUrl,
        client: 'claude-code',
        hostname: os.hostname(),
        os: `${process.platform}-${os.arch()}`,
        cwd: process.cwd(),
        cli_version: '1.0.0',
      });
      const authUrl = `${AUTH_BASE_URL}?${params.toString()}`;
      openBrowser(authUrl);
    });

    server.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error(`Failed to start auth server: ${err.message}`));
      }
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        server.close();
        reject(new Error('AUTH_TIMEOUT'));
      }
    }, AUTH_TIMEOUT);
  });
}

module.exports = {
  AUTH_BASE_URL,
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  startAuthFlow,
};
