const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  loadCredentials,
  getAccessToken,
  getOAuthConfig,
  startBackgroundAuth,
} = require('./auth');

// A token right after login is fresh; this only bounds an unexpected refresh.
const REFRESH_WAIT_MS = 3000;
const {
  listOAuthOrgs,
  routeOrganization,
} = require('../vendor/agent-config.cjs');
const { loadProjectConfig } = require('./project-config');

const BASE_URL = 'https://api.supermemory.ai';
const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  includeTools: [],
  maxProfileItems: 5,
  debug: false,
  injectProfile: true,
  recallDirective: null,
  signalExtraction: false,
  signalKeywords: [
    'remember',
    'implementation',
    'refactor',
    'architecture',
    'decision',
    'important',
    'bug',
    'fix',
    'solved',
    'solution',
    'pattern',
    'approach',
    'design',
    'tradeoff',
    'migrate',
    'upgrade',
    'deprecate',
  ],
  signalTurnsBefore: 3,
};

function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      Object.assign(
        settings,
        JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')),
      );
    }
  } catch (err) {
    console.error(`Settings: Failed to load ${SETTINGS_FILE}: ${err.message}`);
  }
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

const LOGIN_HINT = `node "${path.join(__dirname, 'auth.js')}" login`;

function authRequired() {
  return Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
}

// Which of this plugin's OAuth logins the directory uses, from the shared
// rules in ~/.supermemory/config.json and the repository's team file.
function routeDirectory(cwd, credentials = loadCredentials()) {
  return routeOrganization({
    cwd: cwd || process.cwd(),
    held: credentials?.type === 'oauth' ? listOAuthOrgs(credentials) : [],
    loginHint: LOGIN_HINT,
  });
}

// The directory belongs to an org this plugin can't use (not logged in to it,
// or the API rejected it). Nothing is saved or recalled, and no other org is
// used in its place.
function orgPaused(route) {
  return Object.assign(
    new Error(route.warnings[0] || 'Supermemory is paused in this directory.'),
    { code: 'ORG_PAUSED', route },
  );
}

const ORG_PROMPTS_FILE = path.join(SETTINGS_DIR, 'org-login-prompts.json');
const ORG_PROMPT_INTERVAL_MS = 12 * 60 * 60 * 1000;

// A paused directory opens the consent screen at most every 12 hours per org,
// so a repo for an org you left doesn't open a browser every session.
function claimOrgLoginPrompt(route) {
  const key = `${route.source}:${route.orgId || route.detail || ''}`;
  let prompts = {};
  try {
    prompts = JSON.parse(fs.readFileSync(ORG_PROMPTS_FILE, 'utf-8')) || {};
  } catch {}
  if (Date.now() - (prompts[key] || 0) < ORG_PROMPT_INTERVAL_MS) return false;
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      ORG_PROMPTS_FILE,
      JSON.stringify({ ...prompts, [key]: Date.now() }),
    );
  } catch {}
  return true;
}

async function getAuthToken(cwd, projectConfig, timeoutMs) {
  if (process.env.SUPERMEMORY_CC_API_KEY)
    return process.env.SUPERMEMORY_CC_API_KEY;

  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  if (projectConfig?.apiKey) return projectConfig.apiKey;

  const credentials = loadCredentials();
  if (credentials?.type === 'oauth') {
    const route = routeDirectory(cwd, credentials);
    if (route.paused) throw orgPaused(route);
    if (!route.orgId) throw authRequired();
    return getAccessToken(
      getOAuthConfig(
        getBaseUrl(cwd, projectConfig),
        getMcpUrl(cwd, projectConfig),
      ),
      route.orgId,
      timeoutMs,
    );
  }
  if (credentials?.apiKey) return credentials.apiKey;

  throw authRequired();
}

// Log in from this directory and return the token it should use. The login
// runs in the background (the hook is killed at 30s) and adds the org picked
// on the consent screen. A repository that wasn't routed yet and would have
// used a different org is bound to the new one, so a later default change
// can't move its memories. Rejects with AUTH_PENDING while the user is still
// in the browser.
async function loginForDirectory(cwd, projectConfig, waitMs) {
  const config = getOAuthConfig(
    getBaseUrl(cwd, projectConfig),
    getMcpUrl(cwd, projectConfig),
  );
  const before = routeDirectory(cwd);
  const { orgId, boundRepo } = await startBackgroundAuth(config, waitMs, {
    cwd,
    before: { source: before.source, orgId: before.orgId },
  });
  const notices = boundRepo
    ? [
        `This repository (${boundRepo}) now uses organization ${orgId}. Undo by removing the rule from ~/.supermemory/config.json.`,
      ]
    : [];
  const route = routeDirectory(cwd);
  if (route.paused || !route.orgId) {
    throw orgPaused({
      ...route,
      warnings: [
        `You logged in to organization ${orgId}, but this directory belongs to ${route.orgId || route.detail || 'another organization'}. Log in again and pick that organization.`,
      ],
    });
  }
  return {
    apiKey: await getAccessToken(config, route.orgId, REFRESH_WAIT_MS),
    notices,
  };
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return null;

  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function getBaseUrl(cwd, projectConfig) {
  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  const configured =
    process.env.SUPERMEMORY_API_URL || projectConfig?.baseUrl || BASE_URL;
  const normalized = normalizeBaseUrl(configured);
  if (!normalized) {
    throw new Error('Invalid baseUrl: expected an absolute http(s) URL');
  }
  return normalized;
}

function getMcpUrl(cwd, projectConfig) {
  if (process.env.SUPERMEMORY_MCP_URL) {
    const configured = normalizeBaseUrl(process.env.SUPERMEMORY_MCP_URL);
    if (!configured) throw new Error('Invalid SUPERMEMORY_MCP_URL');
    return configured;
  }
  const api = new URL(getBaseUrl(cwd, projectConfig));
  if (api.hostname.startsWith('api.')) {
    api.hostname = api.hostname.replace(/^api\./, 'mcp.');
    api.pathname = '/mcp';
    api.search = '';
    api.hash = '';
    return api.toString();
  }
  throw new Error('Set SUPERMEMORY_MCP_URL for a custom Supermemory backend.');
}

function resolveApiVersion(baseUrl, configured) {
  if (configured !== undefined && configured !== '') {
    if (configured !== 'v5' && configured !== 'legacy') {
      throw new Error('Invalid apiVersion: expected "v5" or "legacy"');
    }
    return configured;
  }
  const url = new URL(baseUrl);
  const hosted =
    url.origin === BASE_URL &&
    !url.pathname.replace(/\/+$/, '') &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  return hosted ? 'v5' : 'legacy';
}

function getApiVersion(cwd, projectConfig) {
  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  return resolveApiVersion(
    getBaseUrl(cwd, projectConfig),
    process.env.SUPERMEMORY_API_VERSION || projectConfig?.apiVersion,
  );
}

function debugLog(settings, message, data) {
  if (settings.debug) {
    const timestamp = new Date().toISOString();
    console.error(
      data
        ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
        : `[${timestamp}] ${message}`,
    );
  }
}

function getIncludeTools(cwd) {
  const settings = loadSettings();
  const projectConfig = loadProjectConfig(cwd || process.cwd());
  const merged = [
    ...new Set([
      ...(settings.includeTools || []),
      ...(projectConfig?.includeTools || []),
    ]),
  ];
  return merged.map((t) => t.toLowerCase());
}

function shouldIncludeTool(toolName, includeList) {
  if (includeList.length === 0) return false;
  return includeList.includes(toolName.toLowerCase());
}

function getSignalConfig(cwd) {
  const settings = loadSettings();
  const projectConfig = loadProjectConfig(cwd || process.cwd());

  const enabled =
    projectConfig?.signalExtraction !== undefined
      ? projectConfig.signalExtraction
      : settings.signalExtraction || false;

  const keywords = [
    ...new Set([
      ...(settings.signalKeywords || DEFAULT_SETTINGS.signalKeywords),
      ...(projectConfig?.signalKeywords || []),
    ]),
  ].map((k) => k.toLowerCase());

  const turnsBefore =
    projectConfig?.signalTurnsBefore ||
    settings.signalTurnsBefore ||
    DEFAULT_SETTINGS.signalTurnsBefore;

  return { enabled, keywords, turnsBefore };
}

function getRecallConfig(cwd) {
  const settings = loadSettings();
  const projectConfig = loadProjectConfig(cwd || process.cwd());
  return {
    directive:
      projectConfig?.recallDirective || settings.recallDirective || null,
  };
}

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  loadSettings,
  getAuthToken,
  loginForDirectory,
  routeDirectory,
  claimOrgLoginPrompt,
  getBaseUrl,
  getMcpUrl,
  getApiVersion,
  resolveApiVersion,
  debugLog,
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
  getRecallConfig,
};
