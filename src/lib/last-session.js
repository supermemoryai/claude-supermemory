const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const LAST_SESSION_FILE = path.join(SETTINGS_DIR, 'last-session.json');
const OLD_PLAIN_ID_FILE = path.join(SETTINGS_DIR, 'last-session-document-id');

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

/**
 * Save the current Claude session's Supermemory document info.
 * This allows /claude-supermemory:session to show the correct deep link.
 */
function saveLastSession({ id, containerTag }) {
  if (!id) return;

  ensureDir();

  const data = {
    id,
    containerTag: containerTag || null,
    savedAt: new Date().toISOString(),
  };

  fs.writeFileSync(LAST_SESSION_FILE, JSON.stringify(data, null, 2));

  // Clean up legacy plain-text file
  try {
    if (fs.existsSync(OLD_PLAIN_ID_FILE)) {
      fs.unlinkSync(OLD_PLAIN_ID_FILE);
    }
  } catch {}
}

module.exports = {
  saveLastSession,
  LAST_SESSION_FILE,
  OLD_PLAIN_ID_FILE,
};
