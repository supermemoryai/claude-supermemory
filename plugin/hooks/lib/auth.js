const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const authSuccessHtml = fs.readFileSync(
  path.join(__dirname, '../templates/auth-success.html'),
  'utf-8',
);
const authErrorHtml = fs.readFileSync(
  path.join(__dirname, '../templates/auth-error.html'),
  'utf-8',
);

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

const AUTH_BASE_URL =
  process.env.SUPERMEMORY_AUTH_URL || 'https://app.supermemory.ai/auth/connect';
const AUTH_TIMEOUT = 25000;

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (err) => {
      err ? reject(err) : resolve();
    });
  });
}

async function openUrl(url) {
  const target = url.toString();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('Refusing to open non-http URL');
  }
  if (process.platform === 'win32') {
    try {
      await execFileAsync('rundll32.exe', [
        'url.dll,FileProtocolHandler',
        target,
      ]);
      return;
    } catch {}
    await execFileAsync('cmd.exe', ['/c', 'start', '""', target]);
    return;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [target]);
    return;
  }
  await execFileAsync('xdg-open', [target]);
}

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
  const temporaryFile = `${CREDENTIALS_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, CREDENTIALS_FILE);
    try {
      fs.chmodSync(CREDENTIALS_FILE, 0o600);
    } catch {}
  } finally {
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    } catch {}
  }
}

function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {}
}

function createBrowserAuthUrl(callbackUrl, mode) {
  const authUrl = new URL(AUTH_BASE_URL);
  authUrl.searchParams.set('callback', callbackUrl.toString());
  authUrl.searchParams.set('client', 'claude_code');
  if (mode === 'switch_organization') {
    authUrl.searchParams.set('mode', mode);
  }
  return authUrl;
}

function startAuthFlow(options = {}) {
  return new Promise((resolve, reject) => {
    const persist = options.persist !== false;
    const opener = options.openUrl || openUrl;
    const createServer = options.createServer || http.createServer;
    const timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT;
    const expectedState = randomBytes(32).toString('hex');
    let settled = false;
    let timeout;

    const finish = (error, apiKey) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        server.close();
      } catch {}
      if (error) reject(error);
      else resolve(apiKey);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/callback') {
        if (url.searchParams.get('state') !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(authErrorHtml);
          return;
        }

        const apiKey =
          url.searchParams.get('apikey') || url.searchParams.get('api_key');

        if (apiKey?.startsWith('sm_')) {
          try {
            if (persist) saveCredentials(apiKey);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(authSuccessHtml);
            finish(null, apiKey);
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(authErrorHtml);
            finish(new Error(`Failed to save credentials: ${error.message}`));
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(authErrorHtml);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(new Error('Failed to determine auth callback port'));
        return;
      }

      const callbackUrl = new URL(
        `/callback?state=${expectedState}`,
        `http://127.0.0.1:${address.port}`,
      );
      const authUrl = createBrowserAuthUrl(callbackUrl, options.mode);

      Promise.resolve(opener(authUrl)).catch((error) => {
        finish(new Error(`Failed to open browser: ${error.message}`));
      });
    });

    server.on('error', (err) => {
      finish(new Error(`Failed to start auth server: ${err.message}`));
    });

    timeout = setTimeout(() => {
      finish(new Error('AUTH_TIMEOUT'));
    }, timeoutMs);
  });
}

module.exports = {
  AUTH_BASE_URL,
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  createBrowserAuthUrl,
  startAuthFlow,
  openUrl,
};
