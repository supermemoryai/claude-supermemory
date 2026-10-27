const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

const AUTH_BASE_URL =
  process.env.SUPERMEMORY_AUTH_URL || 'https://console.supermemory.ai/auth/connect';
const AUTH_PORT = 19876;
const AUTH_WAIT_MS = 5 * 60 * 1000;
const HOOK_WAIT_MS = 20000;
const POLL_MS = 500;

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

// The SessionStart hook is killed at 30s, so the callback server runs detached and outlives it.
function startAuthFlow() {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, '../auth-server.js')],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const fail = () => {
      clearInterval(timer);
      reject(new Error('AUTH_FAILED'));
    };
    child.on('error', fail);
    child.on('exit', (code) => {
      if (code !== 0) fail();
    });
    const timer = setInterval(() => {
      const credentials = loadCredentials();
      if (credentials) {
        clearInterval(timer);
        resolve(credentials.apiKey);
      } else if (Date.now() - startedAt > HOOK_WAIT_MS) {
        clearInterval(timer);
        reject(new Error('AUTH_PENDING'));
      }
    }, POLL_MS);
  });
}

module.exports = {
  AUTH_BASE_URL,
  AUTH_PORT,
  AUTH_WAIT_MS,
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  startAuthFlow,
  openUrl,
};
