const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

const AUTH_BASE_URL = process.env.SUPERMEMORY_AUTH_URL || 'https://console.supermemory.ai/auth/connect';
const AUTH_PORT = 19876;
const AUTH_TIMEOUT = 25000;

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
    savedAt: new Date().toISOString()
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
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

function startAuthFlow() {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);

      if (url.pathname === '/callback') {
        const apiKey = url.searchParams.get('apikey') || url.searchParams.get('api_key');

        if (apiKey && apiKey.startsWith('sm_')) {
          saveCredentials(apiKey);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<!DOCTYPE html>
<html>
<head><title>Connected - Supermemory</title><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;background:#faf9f6}
.status-box{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid #e5e0db;border-radius:50px;margin-bottom:32px}
.dot{width:8px;height:8px;background:#c75d38;border-radius:50%}
.status-text{font-size:14px;color:#c75d38;letter-spacing:0.5px}
h1{font-size:36px;font-weight:500;color:#1a1a1a;margin:0 0 16px;letter-spacing:-0.5px}
h1 span{color:#c75d38}
p{color:#666;font-size:16px;margin:0}
</style></head>
<body>
<div class="status-box"><span class="dot"></span><span class="status-text">Connected . . .</span></div>
<h1>Claude Code <span>×</span> Supermemory</h1>
<p>You can close this window and return to your terminal.</p>
</body>
</html>`);
          resolved = true;
          server.close();
          resolve(apiKey);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<!DOCTYPE html>
<html>
<head><title>Error - Supermemory</title><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;background:#faf9f6}
.status-box{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid #e5e0db;border-radius:50px;margin-bottom:32px}
.dot{width:8px;height:8px;background:#ef4444;border-radius:50%}
.status-text{font-size:14px;color:#ef4444;letter-spacing:0.5px}
h1{font-size:36px;font-weight:500;color:#1a1a1a;margin:0 0 16px;letter-spacing:-0.5px}
p{color:#666;font-size:16px;margin:0}
</style></head>
<body>
<div class="status-box"><span class="dot"></span><span class="status-text">Error . . .</span></div>
<h1>Connection Failed</h1>
<p>Invalid API key received. Please try again.</p>
</body>
</html>`);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(AUTH_PORT, '127.0.0.1', () => {
      const callbackUrl = `http://localhost:${AUTH_PORT}/callback`;
      const authUrl = `${AUTH_BASE_URL}?callback=${encodeURIComponent(callbackUrl)}&client=claude_code`;
      openBrowser(authUrl);
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
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  startAuthFlow
};
