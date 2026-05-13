// OAuth 2.1 PKCE flow against @better-auth/oauth-provider. Reference impl for the other plugins.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

let _successHtml;
let _errorHtml;
function authSuccessHtml() {
  if (_successHtml !== undefined) return _successHtml;
  try {
    _successHtml = require('../templates/auth-success.html');
  } catch {
    _successHtml = fs.readFileSync(
      path.join(__dirname, '..', 'templates', 'auth-success.html'),
      'utf-8',
    );
  }
  return _successHtml;
}
function authErrorHtml() {
  if (_errorHtml !== undefined) return _errorHtml;
  try {
    _errorHtml = require('../templates/auth-error.html');
  } catch {
    _errorHtml = fs.readFileSync(
      path.join(__dirname, '..', 'templates', 'auth-error.html'),
      'utf-8',
    );
  }
  return _errorHtml;
}

const CLIENT_ID = 'supermemory-claude-code';
const SCOPES = 'openid profile email offline_access';
const CALLBACK_PORT = 19876;
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const SETTINGS_DIR =
  process.env.SUPERMEMORY_HOME_DIR ||
  path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');

const API_URL_DEFAULT = 'https://api.supermemory.ai';
const apiUrl = () =>
  (process.env.SUPERMEMORY_API_URL || API_URL_DEFAULT).replace(/\/+$/, '');
const authEndpoint = (suffix) => `${apiUrl()}/api/auth/oauth2/${suffix}`;
// RFC 8707 — required for JWT access tokens (opaque otherwise).
const resourceIndicator = () => apiUrl();

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
    if (data.accessToken) {
      return {
        tokenType: 'oauth',
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Number(data.expiresAt) || 0,
        scope: data.scope,
        organizationId: data.organizationId,
      };
    }
    if (typeof data.apiKey === 'string' && data.apiKey.startsWith('sm_')) {
      return { tokenType: 'apiKey', apiKey: data.apiKey };
    }
  } catch {}
  return null;
}

function saveOauthCredentials({
  accessToken,
  refreshToken,
  expiresIn,
  scope,
  organizationId,
}) {
  ensureDir();
  const payload = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000,
    scope,
    organizationId,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {}
  return payload;
}

function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
  } catch {}
}

const b64url = (buf) =>
  buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

function newPkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  return { verifier, challenge };
}

function openBrowser(url) {
  const onError = (err) => {
    if (err) console.warn('Failed to open browser:', err.message);
  };
  if (process.platform === 'win32') execFile('explorer.exe', [url], onError);
  else if (process.platform === 'darwin') execFile('open', [url], onError);
  else execFile('xdg-open', [url], onError);
}

async function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const msg =
      json.error_description ||
      json.error ||
      `HTTP ${res.status} from ${new URL(url).pathname}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function exchangeCode({ code, codeVerifier, redirectUri }) {
  return postForm(authEndpoint('token'), {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    resource: resourceIndicator(),
  });
}

async function refreshTokens(refreshToken) {
  return postForm(authEndpoint('token'), {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    resource: resourceIndicator(),
  });
}

function decodeJwtPayload(token) {
  try {
    const seg = token.split('.')[1];
    if (!seg) return {};
    const json = Buffer.from(
      seg.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function startOAuthFlow(opts = {}) {
  const port = opts.port || CALLBACK_PORT;
  const timeoutMs = opts.timeoutMs || AUTH_TIMEOUT_MS;
  const redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`;

  return new Promise((resolve, reject) => {
    const { verifier, challenge } = newPkcePair();
    const state = b64url(crypto.randomBytes(32));
    let settled = false;

    const settle =
      (fn) =>
      (...args) => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {}
        clearTimeout(timer);
        fn(...args);
      };
    const done = settle(resolve);
    const fail = settle(reject);

    const server = http.createServer(async (req, res) => {
      const requrl = new URL(req.url || '/', `http://${CALLBACK_HOST}:${port}`);
      if (requrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end('Not found');
        return;
      }
      const code = requrl.searchParams.get('code');
      const returnedState = requrl.searchParams.get('state');
      const error = requrl.searchParams.get('error');
      const errDesc = requrl.searchParams.get('error_description');
      if (error || !code) {
        res
          .writeHead(400, { 'Content-Type': 'text/html' })
          .end(authErrorHtml());
        fail(new Error(errDesc || error || 'No authorization code returned'));
        return;
      }
      if (returnedState !== state) {
        res
          .writeHead(400, { 'Content-Type': 'text/html' })
          .end(authErrorHtml());
        fail(new Error('OAuth state mismatch — aborting (possible CSRF).'));
        return;
      }
      try {
        const tokens = await exchangeCode({
          code,
          codeVerifier: verifier,
          redirectUri,
        });
        const claims = decodeJwtPayload(tokens.access_token);
        const saved = saveOauthCredentials({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          scope: tokens.scope,
          organizationId: claims.organization_id,
        });
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(authSuccessHtml());
        done({
          accessToken: saved.accessToken,
          refreshToken: saved.refreshToken,
          expiresAt: saved.expiresAt,
          organizationId: saved.organizationId,
        });
      } catch (e) {
        res
          .writeHead(500, { 'Content-Type': 'text/html' })
          .end(authErrorHtml());
        fail(e);
      }
    });

    server.on('error', (e) =>
      fail(new Error(`Loopback server failed: ${e.message}`)),
    );

    server.listen(port, CALLBACK_HOST, () => {
      const authorizeUrl = new URL(authEndpoint('authorize'));
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('code_challenge', challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('resource', resourceIndicator());
      const urlStr = authorizeUrl.toString();
      if (opts.onAuthorizeUrl) opts.onAuthorizeUrl(urlStr);
      openBrowser(urlStr);
    });

    const timer = setTimeout(() => fail(new Error('AUTH_TIMEOUT')), timeoutMs);
  });
}

async function getAccessToken() {
  const creds = loadCredentials();
  if (!creds || creds.tokenType !== 'oauth') return null;
  const skewMs = 60 * 1000;
  if (creds.accessToken && creds.expiresAt - Date.now() > skewMs) {
    return creds.accessToken;
  }
  if (!creds.refreshToken) return null;
  try {
    const tokens = await refreshTokens(creds.refreshToken);
    const claims = decodeJwtPayload(tokens.access_token);
    const saved = saveOauthCredentials({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || creds.refreshToken,
      expiresIn: tokens.expires_in,
      scope: tokens.scope || creds.scope,
      organizationId: claims.organization_id || creds.organizationId,
    });
    return saved.accessToken;
  } catch (_) {
    return null;
  }
}

async function revoke() {
  const creds = loadCredentials();
  if (creds?.tokenType === 'oauth') {
    const tokensToRevoke = [creds.accessToken, creds.refreshToken].filter(
      Boolean,
    );
    for (const token of tokensToRevoke) {
      try {
        await postForm(authEndpoint('revoke'), {
          token,
          client_id: CLIENT_ID,
        });
      } catch {}
    }
  }
  clearCredentials();
}

module.exports = {
  CLIENT_ID,
  CREDENTIALS_FILE,
  loadCredentials,
  clearCredentials,
  startOAuthFlow,
  getAccessToken,
  revoke,
  decodeJwtPayload,
};
