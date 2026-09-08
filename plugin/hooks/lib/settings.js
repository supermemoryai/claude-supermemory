const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadCredentials } = require('./auth');
const { loadProjectConfig } = require('./project-config');

const BASE_URL = 'https://api.supermemory.ai';
const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const SHARED_SETTINGS_FILE = path.join(
  os.homedir(),
  '.codex',
  'supermemory.json',
);
const SHARED_CREDENTIALS_FILE = path.join(
  os.homedir(),
  '.codex',
  'supermemory',
  'credentials.json',
);
const SHARED_RECALL_KEYS = [
  'maxMemories',
  'maxProfileItems',
  'maxRecallTokens',
  'maxPromptRecallTokens',
  'autoRecallContainers',
  'customContainers',
];

const DEFAULT_SETTINGS = {
  includeTools: [],
  maxMemories: 5,
  maxProfileItems: 5,
  maxRecallTokens: 2500,
  maxPromptRecallTokens: 500,
  autoRecallContainers: false,
  customContainers: [],
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

function readSettings(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const value = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch {
    console.error(`Settings: Failed to load ${file}`);
    return {};
  }
}

function loadSettings() {
  const shared = readSettings(SHARED_SETTINGS_FILE);
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of SHARED_RECALL_KEYS) {
    if (Object.hasOwn(shared, key) && shared[key] != null) {
      settings[key] = shared[key];
    }
  }
  Object.assign(settings, readSettings(SETTINGS_FILE));
  settings.autoRecallContainers = settings.autoRecallContainers === true;
  settings.customContainers = Array.isArray(settings.customContainers)
    ? settings.customContainers
        .filter(
          (container) =>
            container &&
            typeof container.tag === 'string' &&
            container.tag.trim() &&
            typeof container.description === 'string',
        )
        .map((container) => ({
          tag: container.tag.trim(),
          description: container.description.trim(),
        }))
    : [];
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

function getApiKey(cwd, projectConfig) {
  if (process.env.SUPERMEMORY_CC_API_KEY)
    return process.env.SUPERMEMORY_CC_API_KEY;

  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  if (projectConfig?.apiKey) return projectConfig.apiKey;

  const credentials = loadCredentials();
  if (credentials?.apiKey) return credentials.apiKey;

  throw new Error('NO_API_KEY');
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

function getBaseUrl(cwd, projectConfig, apiKey) {
  projectConfig = projectConfig || loadProjectConfig(cwd || process.cwd());
  const sharedCredentials = readSettings(SHARED_CREDENTIALS_FILE);
  const sharedBaseUrl =
    apiKey && sharedCredentials.apiKey === apiKey
      ? normalizeBaseUrl(sharedCredentials.apiBaseUrl)
      : null;
  const configured =
    process.env.SUPERMEMORY_API_URL ||
    projectConfig?.baseUrl ||
    sharedBaseUrl ||
    BASE_URL;
  const normalized = normalizeBaseUrl(configured);
  if (!normalized) {
    throw new Error('Invalid baseUrl: expected an absolute http(s) URL');
  }
  return normalized;
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

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
};
