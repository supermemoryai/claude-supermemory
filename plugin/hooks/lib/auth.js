const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const authSuccessHtml = fs.readFileSync(
  path.join(__dirname, '../templates/auth-success.html'),
  'utf-8',
);
const authErrorHtml = fs.readFileSync(
  path.join(__dirname, '../templates/auth-error.html'),
  'utf-8',
);
// The browser only ever sees these fixed strings; error details stay in the
// terminal so a response body can never leak into the page.
function renderAuthError(error) {
  const denied = error?.code === 'access_denied';
  return authErrorHtml
    .replace('{{title}}', denied ? 'Authorization Denied' : 'Connection Failed')
    .replace(
      '{{message}}',
      denied
        ? 'You declined access, so Supermemory was not connected. Return to Claude Code and run the login again to retry.'
        : 'Supermemory could not finish signing you in. Return to Claude Code and run the login again.',
    );
}
const {
  listOAuthOrgs,
  newOAuthStore,
  oauthTokensFor,
  orgIdFromAccessToken,
  upgradeOAuthStore,
  withDefaultOAuthOrg,
  withOAuthTokens,
  withoutAnyOAuthTokens,
  withoutOAuthOrg,
  withRejectedOAuthOrg,
} = require('../vendor/agent-config.cjs');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const CREDENTIALS_FILE = path.join(SETTINGS_DIR, 'credentials.json');
const CLIENT_FILE = path.join(SETTINGS_DIR, 'oauth-client.json');
// Written after every completed login: which org it added, and when. A hook
// waiting on a background login polls it.
const LAST_LOGIN_FILE = path.join(SETTINGS_DIR, 'last-login.json');
const LOCK_FILE = path.join(SETTINGS_DIR, 'auth.lock');
const AUTH_PORT = 19876;
const AUTH_WAIT_MS = 5 * 60 * 1000;
const HOOK_WAIT_MS = 20000;
const POLL_MS = 500;
const REFRESH_TIMEOUT = 3000;
const REFRESH_REQUEST_TIMEOUT = 10000;
const REFRESH_SKEW = 60000;
// A 401 on a token this young means the org itself refused us (removed from
// the org, grant revoked), not an expired token.
const FRESH_TOKEN_MS = 2 * 60 * 1000;
const REDIRECT_URI = `http://127.0.0.1:${AUTH_PORT}/callback`;

function openUrl(url) {
  const target = url.toString();
  if (!/^https?:\/\//i.test(target))
    throw new Error('Refusing to open non-http URL');
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// An API-key file is returned as saved. An OAuth file is returned as the
// per-organization store (v2); a v1 single login is read under the org its
// token names and written back as v2 on the next save.
function loadCredentials() {
  const data = readJson(CREDENTIALS_FILE);
  if (data?.apiKey) return data;
  return upgradeOAuthStore(data)?.store ?? null;
}

function writeJson(file, data) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function saveCredentials(credentials) {
  writeJson(CREDENTIALS_FILE, {
    ...(typeof credentials === 'string'
      ? { apiKey: credentials }
      : credentials),
    savedAt: new Date().toISOString(),
  });
}

// Hooks and the proxy are separate processes. Serialize refresh token rotation
// and re-read credentials under the lock before spending a single-use token.
function recoverAbandonedLock() {
  let recovery;
  let linked = false;
  try {
    const original = fs.statSync(LOCK_FILE);
    // Only one process may reclaim a particular inode. Re-check the inode after
    // linking: another process may already have replaced the abandoned lock.
    recovery = `${LOCK_FILE}.${original.dev}.${original.ino}.recovery`;
    fs.linkSync(LOCK_FILE, recovery);
    linked = true;
    const snapshot = fs.statSync(recovery);
    if (snapshot.ino !== original.ino || snapshot.dev !== original.dev) return;
    const owner = readJson(recovery);
    let abandoned = false;
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        abandoned = error.code === 'ESRCH';
      }
    } else {
      abandoned = Date.now() - snapshot.mtimeMs > AUTH_WAIT_MS * 2;
    }
    if (abandoned) {
      const current = fs.statSync(LOCK_FILE);
      if (current.ino === original.ino && current.dev === original.dev) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;
  } finally {
    if (linked) fs.rmSync(recovery, { force: true });
  }
}

// A login started by a hook waits in the background, so a newer login stops it
// instead of waiting up to five minutes for the lock.
function stopBackgroundLogin() {
  const owner = readJson(LOCK_FILE);
  if (!owner?.background || !Number.isInteger(owner.pid) || owner.pid <= 0)
    return;
  try {
    process.kill(owner.pid);
  } catch {}
}

async function withAuthLock(
  action,
  timeoutMs,
  { background = false, preempt = false } = {},
) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let descriptor;
  let stopped = false;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(LOCK_FILE, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (preempt && !stopped) {
        stopBackgroundLogin();
        stopped = true;
      }
      recoverAbandonedLock();
      if (Date.now() >= deadline)
        throw new Error('Supermemory authentication is busy. Try again.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    fs.writeFileSync(
      descriptor,
      JSON.stringify({ pid: process.pid, ...(background && { background }) }),
    );
    return await action(Math.max(1, deadline - Date.now()));
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(LOCK_FILE, { force: true });
  }
}

function secureUrl(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error(
      'OAuth requires HTTPS (HTTP is allowed only for loopback development).',
    );
  }
  return url.toString().replace(/\/+$/, '');
}

function getOAuthConfig(baseUrl, mcpUrl) {
  const apiBaseUrl = secureUrl(baseUrl);
  const issuer = secureUrl(
    process.env.SUPERMEMORY_OAUTH_ISSUER || `${apiBaseUrl}/api/auth`,
  );
  return { apiBaseUrl, issuer, resource: secureUrl(mcpUrl) };
}

function sameConfig(credentials, config) {
  return ['apiBaseUrl', 'issuer', 'resource'].every(
    (key) => credentials?.[key] === config[key],
  );
}

function issuerEndpoint(value, issuer) {
  const endpoint = secureUrl(value);
  if (new URL(endpoint).origin !== new URL(issuer).origin) {
    throw new Error('OAuth endpoint does not belong to the configured issuer.');
  }
  return endpoint;
}

async function oauthRequest(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error' });
  const body = await response.json().catch(() => null);
  const data = body && typeof body === 'object' ? body : {};
  if (!response.ok) {
    // Never include response bodies or tokens in hook output.
    const code = ['invalid_grant', 'invalid_client', 'access_denied'].includes(
      data.error,
    )
      ? data.error
      : 'oauth_request_failed';
    throw Object.assign(
      new Error(
        `Supermemory authorization failed (${code}, HTTP ${response.status}).`,
      ),
      {
        code,
        status: response.status,
      },
    );
  }
  return data;
}

async function registerClient(config, signal) {
  const saved = readJson(CLIENT_FILE);
  if (
    sameConfig(saved, config) &&
    saved.clientId &&
    saved.redirectUri === REDIRECT_URI
  )
    return saved;
  const metadata = await oauthRequest(
    new URL('/.well-known/oauth-authorization-server', config.issuer),
    { signal },
  );
  if (metadata.issuer !== config.issuer)
    throw new Error('OAuth discovery returned an unexpected issuer.');
  const authorizationEndpoint = issuerEndpoint(
    metadata.authorization_endpoint,
    config.issuer,
  );
  const tokenEndpoint = issuerEndpoint(metadata.token_endpoint, config.issuer);
  const registrationEndpoint = issuerEndpoint(
    metadata.registration_endpoint,
    config.issuer,
  );
  const revocationEndpoint = issuerEndpoint(
    metadata.revocation_endpoint,
    config.issuer,
  );
  const registration = await oauthRequest(registrationEndpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Supermemory for Claude Code',
      client_uri: 'https://github.com/supermemoryai/claude-supermemory',
      software_id: 'claude-supermemory',
      software_version: require('../../.claude-plugin/plugin.json').version,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid profile email offline_access',
    }),
  });
  if (
    typeof registration.client_id !== 'string' ||
    !registration.client_id ||
    registration.token_endpoint_auth_method !== 'none'
  ) {
    throw new Error('OAuth registration did not return a public client.');
  }
  const client = {
    ...config,
    clientId: registration.client_id,
    redirectUri: REDIRECT_URI,
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
  };
  signal.throwIfAborted();
  writeJson(CLIENT_FILE, client);
  return client;
}

async function exchangeToken(client, parameters, signal, previous) {
  const data = await oauthRequest(
    issuerEndpoint(client.tokenEndpoint, client.issuer),
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        resource: client.resource,
        ...parameters,
      }),
    },
  );
  const refreshToken = data.refresh_token ?? previous?.refreshToken;
  if (
    typeof data.access_token !== 'string' ||
    !data.access_token ||
    typeof data.token_type !== 'string' ||
    data.token_type.toLowerCase() !== 'bearer' ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    typeof refreshToken !== 'string' ||
    !refreshToken
  ) {
    throw new Error('OAuth returned an invalid token response.');
  }
  signal.throwIfAborted();
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

function authRequired() {
  return Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
}

// Rotates one organization's refresh token. Never abort a refresh mid-flight:
// the server would rotate a refresh token we never stored, and the next
// refresh would fail with invalid_grant.
const pendingRefreshes = new Map();
const pendingReports = new Set();

function refreshCredentials(config, orgId) {
  const existing = pendingRefreshes.get(orgId);
  if (existing) return existing;
  const pending = withAuthLock(async (remaining) => {
    const store = loadCredentials();
    if (store?.type !== 'oauth' || !sameConfig(store, config))
      throw authRequired();
    const tokens = oauthTokensFor(store, orgId);
    if (!tokens) throw authRequired();
    if (tokens.accessToken && tokens.expiresAt > Date.now() + REFRESH_SKEW)
      return tokens.accessToken;
    try {
      const next = await exchangeToken(
        store,
        { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
        AbortSignal.timeout(remaining),
        tokens,
      );
      // The server keeps a refreshed token on its original org. If it ever
      // didn't, file the tokens where they belong rather than lose them.
      const grantedOrg = orgIdFromAccessToken(next.accessToken) || orgId;
      saveCredentials(withOAuthTokens(store, grantedOrg, next));
      if (grantedOrg !== orgId) throw authRequired();
      return next.accessToken;
    } catch (error) {
      if (error.code === 'invalid_grant') {
        // Only this organization's login is gone; the others keep working.
        saveCredentials(withoutOAuthOrg(store, orgId));
        throw authRequired();
      }
      if (error.code === 'invalid_client') {
        saveCredentials(withoutAnyOAuthTokens(store));
        fs.rmSync(CLIENT_FILE, { force: true });
        throw authRequired();
      }
      throw error;
    }
  }, REFRESH_REQUEST_TIMEOUT).finally(() => {
    pendingRefreshes.delete(orgId);
  });
  // Callers may stop waiting before the refresh settles.
  pending.catch(() => {});
  pendingRefreshes.set(orgId, pending);
  return pending;
}

function waitFor(promise, timeoutMs) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(
          new Error('Supermemory token refresh is still in progress.'),
          { code: 'AUTH_PENDING', name: 'TimeoutError' },
        ),
      );
    }, timeoutMs);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function getAccessToken(config, orgId, timeoutMs = REFRESH_TIMEOUT) {
  const store = loadCredentials();
  if (store?.type !== 'oauth' || !sameConfig(store, config))
    throw authRequired();
  const tokens = oauthTokensFor(store, orgId);
  if (!tokens) throw authRequired();
  if (tokens.accessToken && tokens.expiresAt > Date.now() + REFRESH_SKEW)
    return tokens.accessToken;
  return waitFor(refreshCredentials(config, orgId), timeoutMs);
}

// The API answered 401 for this access token. A token refreshed moments ago
// means the organization refused us: mark it rejected so routing pauses
// instead of using another org. An older token is just expired; force the
// next call to refresh it.
function reportUnauthorized(accessToken) {
  const report = withAuthLock(async () => {
    const store = loadCredentials();
    if (store?.type !== 'oauth') return;
    const entry = Object.entries(store.organizations).find(
      ([, tokens]) => tokens.accessToken === accessToken,
    );
    if (!entry) return;
    const [orgId, tokens] = entry;
    const savedAt = Date.parse(tokens.savedAt || '') || 0;
    if (Date.now() - savedAt < FRESH_TOKEN_MS) {
      saveCredentials(withRejectedOAuthOrg(store, orgId));
      return;
    }
    saveCredentials({
      ...store,
      organizations: {
        ...store.organizations,
        [orgId]: { ...tokens, expiresAt: 0 },
      },
    });
  }, REFRESH_TIMEOUT).catch(() => {});
  pendingReports.add(report);
  report.finally(() => pendingReports.delete(report));
  return report;
}

// Resolves once in-flight refreshes and 401 reports have saved or failed, so a
// process that exits explicitly can let the rotated tokens land first.
async function settleAuth() {
  while (pendingRefreshes.size || pendingReports.size) {
    await Promise.allSettled([...pendingRefreshes.values(), ...pendingReports]);
  }
}

async function revoke(store, refreshToken, signal) {
  await oauthRequest(issuerEndpoint(store.revocationEndpoint, store.issuer), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: store.clientId,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });
}

// Logout. With `orgId`, only that organization's login is revoked and
// forgotten; without it, every organization's.
async function clearCredentials({ orgId } = {}) {
  return withAuthLock(async (remaining) => {
    const store = loadCredentials();
    if (store?.type !== 'oauth') {
      if (!orgId) fs.rmSync(CREDENTIALS_FILE, { force: true });
      return;
    }
    const signal = AbortSignal.timeout(remaining);
    const targets = orgId ? [orgId] : Object.keys(store.organizations);
    for (const target of targets) {
      const tokens = oauthTokensFor(store, target);
      if (tokens) await revoke(store, tokens.refreshToken, signal);
    }
    if (orgId) saveCredentials(withoutOAuthOrg(store, orgId));
    else fs.rmSync(CREDENTIALS_FILE, { force: true });
  }, REFRESH_TIMEOUT);
}

function setDefaultOrganization(orgId) {
  return withAuthLock(async () => {
    const store = loadCredentials();
    const updated = store?.type === 'oauth' && withDefaultOAuthOrg(store, orgId);
    if (!updated) throw new Error(`Not logged in to organization ${orgId}.`);
    saveCredentials(updated);
  }, REFRESH_TIMEOUT);
}

async function startAuthFlow(
  config,
  {
    force = false,
    timeoutMs = AUTH_WAIT_MS,
    printUrl = false,
    background = false,
    // Runs once the new login is saved; may return the repository it bound.
    onLogin = null,
  } = {},
) {
  return withAuthLock(async (remaining) => {
    const current = loadCredentials();
    const fresh =
      current?.type === 'oauth' && sameConfig(current, config)
        ? listOAuthOrgs(current)
            .map((org) => ({ orgId: org.orgId, ...oauthTokensFor(current, org.orgId) }))
            .find((tokens) => tokens.expiresAt > Date.now() + REFRESH_SKEW)
        : null;
    if (!force && fresh)
      return { accessToken: fresh.accessToken, orgId: fresh.orgId };
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('AUTH_TIMEOUT')),
      remaining,
    );
    let server;
    try {
      const client = await registerClient(config, controller.signal);
      const state = crypto.randomBytes(32).toString('base64url');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const authorizationUrl = new URL(
        issuerEndpoint(client.authorizationEndpoint, client.issuer),
      );
      authorizationUrl.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        resource: client.resource,
        code_challenge: crypto
          .createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
        state,
        prompt: 'consent',
      }).toString();
      return await new Promise((resolve, reject) => {
        let exchanging = false;
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason),
          { once: true },
        );
        server = http.createServer(async (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Referrer-Policy', 'no-referrer');
          let url;
          try {
            url = new URL(req.url, REDIRECT_URI);
          } catch {
            res.writeHead(400).end();
            return;
          }
          if (req.method !== 'GET' || url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
          }
          const receivedState = Buffer.from(
            url.searchParams.get('state') || '',
          );
          if (
            receivedState.length !== state.length ||
            !crypto.timingSafeEqual(receivedState, Buffer.from(state)) ||
            (url.searchParams.has('iss') &&
              url.searchParams.get('iss') !== client.issuer)
          ) {
            res.writeHead(400).end('Invalid authorization state.');
            return;
          }
          if (exchanging) {
            res.writeHead(409).end();
            return;
          }
          exchanging = true;
          try {
            if (url.searchParams.has('error'))
              throw Object.assign(new Error('Authorization was denied.'), {
                code: 'access_denied',
              });
            const code = url.searchParams.get('code');
            if (!code) throw new Error('Authorization code missing.');
            const tokens = await exchangeToken(
              client,
              {
                grant_type: 'authorization_code',
                code,
                code_verifier: verifier,
                redirect_uri: REDIRECT_URI,
              },
              controller.signal,
            );
            // Every login is for one organization, picked on the consent
            // screen. It is added next to the others; the first becomes the
            // default.
            const orgId = orgIdFromAccessToken(tokens.accessToken);
            if (!orgId)
              throw new Error(
                'Supermemory did not say which organization this login is for.',
              );
            const saved = loadCredentials();
            const base =
              saved?.type === 'oauth' && sameConfig(saved, config)
                ? { ...saved, ...client }
                : newOAuthStore(client);
            saveCredentials(withOAuthTokens(base, orgId, tokens));
            let boundRepo = null;
            try {
              boundRepo = onLogin?.(orgId) ?? null;
            } catch {}
            writeJson(LAST_LOGIN_FILE, { orgId, at: Date.now(), boundRepo });
            res
              .writeHead(200, { 'Content-Type': 'text/html' })
              .end(authSuccessHtml, () =>
                resolve({ accessToken: tokens.accessToken, orgId }),
              );
          } catch (error) {
            res
              .writeHead(400, { 'Content-Type': 'text/html' })
              .end(renderAuthError(error));
            if (error.code === 'invalid_client' && !controller.signal.aborted)
              fs.rmSync(CLIENT_FILE, { force: true });
            reject(error);
          }
        });
        server.on('error', () =>
          reject(
            new Error(
              'Cannot open the authentication callback port. Retry after other logins finish.',
            ),
          ),
        );
        server.listen(AUTH_PORT, '127.0.0.1', () => {
          // The Supermemory CLI collects these links to approve several
          // plugins on one consent screen.
          if (printUrl) {
            process.stdout.write(`SUPERMEMORY_AUTHORIZE_URL=${authorizationUrl}\n`);
            return;
          }
          openUrl(authorizationUrl).catch(() =>
            reject(
              new Error(
                'Failed to open the browser. Retry login from an interactive terminal.',
              ),
            ),
          );
        });
      });
    } finally {
      clearTimeout(timer);
      controller.abort();
      server?.close();
      server?.closeAllConnections();
    }
  }, timeoutMs, { background, preempt: true });
}

// The SessionStart hook is killed at 30s, so the login runs detached for five
// minutes and the hook only waits briefly for it. `binding` lets the detached
// login bind the hook's repository to the org picked on the consent screen,
// even when that happens after the hook has returned.
function startBackgroundAuth(config, waitMs = HOOK_WAIT_MS, binding = null) {
  const startedAt = Date.now();
  const child = spawn(
    process.execPath,
    [
      path.join(__dirname, '../auth-server.js'),
      config.apiBaseUrl,
      config.resource,
      ...(binding ? [JSON.stringify(binding)] : []),
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  return new Promise((resolve, reject) => {
    const done = (error, result) => {
      clearInterval(timer);
      child.removeAllListeners();
      if (error) reject(error);
      else resolve(result);
    };
    child.on('error', () => done(new Error('AUTH_FAILED')));
    // A newer login stopping this one (a signal) is not a failure.
    child.on('exit', (code, signal) => {
      if (code !== 0 && !signal) done(new Error('AUTH_FAILED'));
    });
    const timer = setInterval(() => {
      const finished = readJson(LAST_LOGIN_FILE);
      const current = loadCredentials();
      const tokens =
        finished?.at >= startedAt && sameConfig(current, config)
          ? oauthTokensFor(current, finished.orgId)
          : null;
      if (tokens?.accessToken) {
        done(null, {
          accessToken: tokens.accessToken,
          orgId: finished.orgId,
          boundRepo: finished.boundRepo ?? null,
        });
      } else if (Date.now() - startedAt > waitMs) {
        done(new Error('AUTH_PENDING'));
      }
    }, POLL_MS);
  });
}

module.exports = {
  CREDENTIALS_FILE,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getOAuthConfig,
  getAccessToken,
  reportUnauthorized,
  setDefaultOrganization,
  settleAuth,
  startAuthFlow,
  startBackgroundAuth,
  AUTH_WAIT_MS,
  openUrl,
};

// Explicit login adds an organization (and migrates a saved API key). Logout
// revokes every organization's refresh token, or one with `--org <id>`.
// Status never prints credentials.
if (require.main === module) {
  (async () => {
    const { getBaseUrl, getMcpUrl } = require('./settings');
    const [command, ...rest] = process.argv.slice(2);
    const flag = (name) => {
      const index = rest.indexOf(name);
      return index >= 0 ? rest[index + 1] : undefined;
    };
    if (command === 'login') {
      const { orgId } = await startAuthFlow(
        getOAuthConfig(getBaseUrl(), getMcpUrl()),
        {
          force: true,
          timeoutMs: 5 * 60 * 1000,
          printUrl: process.argv.includes('--print-url'),
        },
      );
      console.log(`Supermemory connected through OAuth (organization ${orgId}).`);
    } else if (command === 'logout') {
      const orgId = flag('--org');
      await clearCredentials({ orgId });
      console.log(
        orgId
          ? `Supermemory disconnected from organization ${orgId}.`
          : 'Supermemory disconnected.',
      );
    } else if (command === 'use') {
      if (!rest[0]) throw new Error('Usage: node auth.js use <organization-id>');
      await setDefaultOrganization(rest[0]);
      console.log(`Default organization: ${rest[0]}.`);
    } else if (command === 'status') {
      const credentials = loadCredentials();
      const oauth = credentials?.type === 'oauth';
      console.log(
        JSON.stringify(
          {
            authentication: oauth
              ? 'oauth'
              : credentials?.apiKey
                ? 'api_key'
                : 'none',
            clientId: credentials?.clientId,
            organizations: oauth
              ? listOAuthOrgs(credentials).map((org) => ({
                  id: org.orgId,
                  default: org.isDefault,
                  rejected: org.rejected,
                  expiresAt: credentials.organizations[org.orgId].expiresAt,
                }))
              : undefined,
            reauthenticationRequired:
              oauth && listOAuthOrgs(credentials).length === 0,
          },
          null,
          2,
        ),
      );
    } else {
      throw new Error(
        'Usage: node auth.js <login|logout [--org <id>]|use <id>|status>',
      );
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
