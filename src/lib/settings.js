const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadCredentials } = require('./auth');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  skipTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'AskUserQuestion'],
  captureTools: ['Edit', 'Write', 'Bash', 'Task'],
  maxContextMemories: 10,
  maxProjectMemories: 20,
  maxProfileItems: 5,
  debug: false,
  injectProfile: true
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
  if (process.env.SUPERMEMORY_API_KEY) settings.apiKey = process.env.SUPERMEMORY_API_KEY;
  if (process.env.SUPERMEMORY_SKIP_TOOLS) settings.skipTools = process.env.SUPERMEMORY_SKIP_TOOLS.split(',').map(s => s.trim());
  if (process.env.SUPERMEMORY_DEBUG === 'true') settings.debug = true;
  return settings;
}

function saveSettings(settings) {
  ensureSettingsDir();
  const toSave = { ...settings };
  delete toSave.apiKey;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
}

function getApiKey(settings) {
  if (settings.apiKey) return settings.apiKey;
  if (process.env.SUPERMEMORY_API_KEY) return process.env.SUPERMEMORY_API_KEY;

  const credentials = loadCredentials();
  if (credentials?.apiKey) return credentials.apiKey;

  throw new Error('NO_API_KEY');
}

function shouldCaptureTool(toolName, settings) {
  if (settings.skipTools.includes(toolName)) return false;
  if (settings.captureTools && settings.captureTools.length > 0) {
    return settings.captureTools.includes(toolName);
  }
  return true;
}

function debugLog(settings, message, data) {
  if (settings.debug) {
    const timestamp = new Date().toISOString();
    console.error(data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}` : `[${timestamp}] ${message}`);
  }
}

module.exports = {
  SETTINGS_DIR,
  SETTINGS_FILE,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  getApiKey,
  shouldCaptureTool,
  debugLog
};
