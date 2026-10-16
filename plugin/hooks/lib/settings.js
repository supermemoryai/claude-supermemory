const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadCredentials, getAccessToken, getOAuthConfig } = require('./auth');
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
      Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')));
    }
  } catch (err) {
    console.error(`Settings: Failed to load ${SETTINGS_FILE}: ${err.message}`);
  }
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

async function getAuthToken(cwd, projectConfig, timeoutMs) {
  if (process.env.SUPERMEMORY_CC_API_KEY)
    return process.env.SUPERMEMORY_CC_API_KEY;

  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  if (projectConfig?.apiKey) return projectConfig.apiKey;

  const credentials = loadCredentials();
  if (credentials?.type === 'oauth') {
    return getAccessToken(
      getOAuthConfig(
        getBaseUrl(cwd, projectConfig),
        getMcpUrl(cwd, projectConfig),
      ),
      timeoutMs,
    );
  }
  if (credentials?.apiKey) return credentials.apiKey;

  throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
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
    directive: projectConfig?.recallDirective || settings.recallDirective || null,
  };
}

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  loadSettings,
  getAuthToken,
  getBaseUrl,
  getMcpUrl,
  debugLog,
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
  getRecallConfig,
};
