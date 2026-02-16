const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const GLOBAL_SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const GLOBAL_SETTINGS_FILE = 'settings.json';

function getGlobalSettingsPath() {
  return path.join(GLOBAL_SETTINGS_DIR, GLOBAL_SETTINGS_FILE);
}

function loadGlobalSettings() {
  try {
    const settingsPath = getGlobalSettingsPath();
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveGlobalSettings(settings) {
  const settingsPath = getGlobalSettingsPath();

  if (!fs.existsSync(GLOBAL_SETTINGS_DIR)) {
    fs.mkdirSync(GLOBAL_SETTINGS_DIR, { recursive: true });
  }

  const existing = loadGlobalSettings() || {};
  const data = {
    ...existing,
    ...settings,
  };
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  return settingsPath;
}

module.exports = {
  getGlobalSettingsPath,
  loadGlobalSettings,
  saveGlobalSettings,
};
