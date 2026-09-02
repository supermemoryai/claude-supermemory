const { execFile } = require('node:child_process');
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
  process.env.SUPERMEMORY_AUTH_URL ||
  'https://console.supermemory.ai/auth/connect';
const AUTH_PORT = 19876;
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
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
}

function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {}
}

function startAuthFlow() {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);

      if (url.pathname === '/callback') {
        const apiKey =
          url.searchParams.get('apikey') || url.searchParams.get('api_key');

        if (apiKey?.startsWith('sm_')) {
          saveCredentials(apiKey);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(authSuccessHtml);
          resolved = true;
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

    server.listen(AUTH_PORT, '127.0.0.1', () => {
      const callbackUrl = `http://localhost:${AUTH_PORT}/callback`;
      const authUrl = `${AUTH_BASE_URL}?callback=${encodeURIComponent(callbackUrl)}&client=claude_code`;
      openUrl(authUrl).catch((error) => {
        if (!resolved) {
          server.close();
          reject(new Error(`Failed to open browser: ${error.message}`));
        }
      });
    });

    server.on('error', (err) => {
      if (!resolved) {
        reject(new Error(`Failed to start auth server: ${err.message}`));
      }
    });

    setTimeout(() => {
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
  openUrl,
};
