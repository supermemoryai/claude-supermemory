const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const STATE_FILE = path.join(os.tmpdir(), '.claude-supermemory-statusline');

function writeState(data) {
  try {
    const existing = readState();
    if (data.ingesting === true) {
      data.ingestStartedAt = Date.now();
    }
    const merged = { ...existing, ...data, updatedAt: Date.now() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged));
  } catch {
    // statusline is best-effort
  }
}

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

module.exports = { writeState, readState, STATE_FILE };
