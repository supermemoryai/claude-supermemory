const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadProjectConfig } = require('./project-config');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  includeTools: [],
  maxProfileItems: 5,
  debug: false,
  injectProfile: true,
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

function ensureSettingsDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      Object.assign(settings, JSON.parse(fileContent));
    }
  } catch (err) {
    console.error(`Settings: Failed to load ${SETTINGS_FILE}: ${err.message}`);
  }
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

function saveSettings(settings) {
  ensureSettingsDir();
  const toSave = { ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
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

  const globalInclude = settings.includeTools || [];
  const projectInclude = projectConfig?.includeTools || [];

  const merged = [...new Set([...globalInclude, ...projectInclude])];
  return merged.map((t) => t.toLowerCase());
}

function shouldIncludeTool(toolName, includeList) {
  if (includeList.length === 0) return false;
  return includeList.includes(toolName.toLowerCase());
}

function getSignalConfig(cwd) {
  const settings = loadSettings();
  const projectConfig = loadProjectConfig(cwd || process.cwd());

  const globalEnabled = settings.signalExtraction || false;
  const projectEnabled = projectConfig?.signalExtraction;

  const enabled = projectEnabled !== undefined ? projectEnabled : globalEnabled;

  const globalKeywords =
    settings.signalKeywords || DEFAULT_SETTINGS.signalKeywords;
  const projectKeywords = projectConfig?.signalKeywords || [];

  const keywords = [...new Set([...globalKeywords, ...projectKeywords])].map(
    (k) => k.toLowerCase(),
  );

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
  saveSettings,
  debugLog,
  getIncludeTools,
  shouldIncludeTool,
  getSignalConfig,
};
