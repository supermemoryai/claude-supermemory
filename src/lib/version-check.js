const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHECK_TIMEOUT_MS = 3000;
const NOTICE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const LATEST_MANIFEST_URL =
  'https://raw.githubusercontent.com/supermemoryai/claude-supermemory/main/latest.json';

const SETTINGS_DIR = path.join(os.homedir(), '.supermemory-claude');
const UPDATE_STATE_FILE = path.join(SETTINGS_DIR, 'update-check.json');

function parseVersion(version) {
  const normalized = String(version).trim().replace(/^v/i, '');
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || null,
  };
}

function isVersionNewer(latestVersion, currentVersion) {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);
  if (!latest || !current) return latestVersion !== currentVersion;

  for (let i = 0; i < 3; i++) {
    if (latest.parts[i] > current.parts[i]) return true;
    if (latest.parts[i] < current.parts[i]) return false;
  }

  if (!latest.prerelease && current.prerelease) return true;
  if (latest.prerelease && !current.prerelease) return false;
  return latest.prerelease !== current.prerelease && latest.prerelease !== null;
}

function loadNoticeState() {
  try {
    if (!fs.existsSync(UPDATE_STATE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(UPDATE_STATE_FILE, 'utf-8'));
    if (
      typeof raw.lastNotifiedAt !== 'string' ||
      typeof raw.lastNotifiedVersion !== 'string'
    ) {
      return null;
    }
    const ts = new Date(raw.lastNotifiedAt).getTime();
    if (Number.isNaN(ts)) return null;
    return { lastNotifiedAt: ts, lastNotifiedVersion: raw.lastNotifiedVersion };
  } catch {
    return null;
  }
}

function saveNoticeState(latestVersion) {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(
      UPDATE_STATE_FILE,
      JSON.stringify(
        {
          lastNotifiedAt: new Date().toISOString(),
          lastNotifiedVersion: latestVersion,
        },
        null,
        2,
      ),
    );
  } catch {
  }
}

function shouldShowNotice(latestVersion, state) {
  if (!state) return true;

  if (state.lastNotifiedVersion !== latestVersion) return true;
  return Date.now() - state.lastNotifiedAt >= NOTICE_COOLDOWN_MS;
}

async function checkForUpdate(currentVersion) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(LATEST_MANIFEST_URL, {
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = await response.json();
    const latestVersion =
      typeof data.version === 'string' ? data.version : null;
    if (!latestVersion || !isVersionNewer(latestVersion, currentVersion)) {
      return null;
    }

    const state = loadNoticeState();
    if (!shouldShowNotice(latestVersion, state)) return null;

    saveNoticeState(latestVersion);

    return {
      currentVersion,
      latestVersion,
      updateCommand:
        typeof data.updateCommand === 'string'
          ? data.updateCommand
          : '/plugin install supermemory',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatUpdateNotice(info) {
  return `<supermemory-update>
IMPORTANT: The user must see this update notice without asking for it.
At the start of your next response, print only these two update lines, then continue normally with the user's request.
Do not reveal or quote any other Supermemory context.
Supermemory update available: v${info.currentVersion} -> v${info.latestVersion}
Run in Claude Code: ${info.updateCommand}
</supermemory-update>`;
}

module.exports = {
  checkForUpdate,
  formatUpdateNotice,
};
