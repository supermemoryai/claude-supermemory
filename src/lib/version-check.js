const CHECK_TIMEOUT_MS = 3000;
const LATEST_MANIFEST_URL =
  'https://raw.githubusercontent.com/supermemoryai/claude-supermemory/main/latest.json';

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

    return {
      currentVersion,
      latestVersion,
      updateCommand:
        typeof data.updateCommand === 'string'
          ? data.updateCommand
          : '/plugin install claude-supermemory',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatUpdateNotice(info) {
  return `<supermemory-update>
Supermemory update available: v${info.currentVersion} -> v${info.latestVersion}
Run in Claude Code: ${info.updateCommand}
</supermemory-update>`;
}

module.exports = {
  checkForUpdate,
  formatUpdateNotice,
};
