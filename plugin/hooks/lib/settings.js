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

const DEFAULT_SETTINGS = {
  includeTools: [],
  maxMemories: 5,
  maxProfileItems: 5,
  maxRecallTokens: 2500,
  maxPromptRecallTokens: null,
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

function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  for (const file of [SHARED_SETTINGS_FILE, SETTINGS_FILE]) {
    try {
      if (fs.existsSync(file)) {
        Object.assign(settings, JSON.parse(fs.readFileSync(file, 'utf-8')));
      }
    } catch (err) {
      console.error(`Settings: Failed to load ${file}: ${err.message}`);
    }
  }
  settings.maxPromptRecallTokens ??= settings.maxRecallTokens;
  settings.customContainers = Array.isArray(settings.customContainers)
    ? settings.customContainers.filter(
        (container) =>
          container &&
          typeof container.tag === 'string' &&
          container.tag.trim() &&
          typeof container.description === 'string' &&
          container.description.trim(),
      )
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
    maxMemories: settings.maxMemories,
    maxProfileItems: settings.maxProfileItems,
    maxRecallTokens: settings.maxRecallTokens,
    maxPromptRecallTokens: settings.maxPromptRecallTokens,
    autoRecallContainers: settings.autoRecallContainers,
    customContainers: settings.customContainers,
  };
}

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  SHARED_SETTINGS_FILE,
  DEFAULT_SETTINGS,
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
  getRecallConfig,
};
