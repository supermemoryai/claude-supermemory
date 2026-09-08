const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const STATE_DIR_NAME = 'statusline-state';
const EVENT_NAMES = new Set(['context', 'capture', 'search']);
const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Fixed location: hooks and the statusline renderer run in different process
// environments, so neither may trust env vars to find the other's state.
function resolveStatuslineDataDir(explicitDir) {
  return (
    explicitDir || path.join(os.homedir(), '.supermemory-claude', 'statusline')
  );
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function getStateRoot(dataDir) {
  return path.join(resolveStatuslineDataDir(dataDir), STATE_DIR_NAME);
}

function getSessionDir(sessionId, dataDir) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  return path.join(getStateRoot(dataDir), hashValue(sessionId.trim()));
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
}

function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  ensurePrivateDir(dir);
  const temporary = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  try {
    fs.writeFileSync(temporary, JSON.stringify(value), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Best effort on filesystems without POSIX permissions.
    }
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The rename already removed the temporary file in the normal path.
    }
  }
}

function sanitizeEvent(event, data) {
  if (event === 'context') {
    const status = ['loading', 'ready', 'error'].includes(data.status)
      ? data.status
      : 'ready';
    return {
      status,
      memoryItemsLoaded: normalizeCount(data.memoryItemsLoaded),
    };
  }

  if (event === 'capture') {
    const status = ['saving', 'saved', 'error'].includes(data.status)
      ? data.status
      : 'error';
    return { status, count: normalizeCount(data.count) };
  }

  return {
    results: normalizeCount(data.results),
    count: normalizeCount(data.count),
    memories: normalizeCount(data.memories),
  };
}

function writeState(sessionId, event, data = {}, options = {}) {
  if (!EVENT_NAMES.has(event)) return false;
  const sessionDir = getSessionDir(sessionId, options.dataDir);
  if (!sessionDir) return false;

  try {
    const record = {
      version: SCHEMA_VERSION,
      event,
      updatedAt: options.now ?? Date.now(),
      ...sanitizeEvent(event, data),
    };
    atomicWriteJson(path.join(sessionDir, `${event}.json`), record);
    return true;
  } catch {
    return false;
  }
}

function readEvent(sessionDir, event) {
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(sessionDir, `${event}.json`), 'utf8'),
    );
    if (
      record?.version !== SCHEMA_VERSION ||
      record?.event !== event ||
      !Number.isFinite(record?.updatedAt)
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function readState(sessionId, options = {}) {
  const sessionDir = getSessionDir(sessionId, options.dataDir);
  if (!sessionDir) return {};

  return {
    context: readEvent(sessionDir, 'context'),
    capture: readEvent(sessionDir, 'capture'),
    search: readEvent(sessionDir, 'search'),
  };
}

function countLoadedProfileItems(profileResult, maxItems) {
  const limit = normalizeCount(maxItems);
  const staticCount = Math.min(
    profileResult?.profile?.static?.length || 0,
    limit,
  );
  const dynamicCount = Math.min(
    profileResult?.profile?.dynamic?.length || 0,
    limit,
  );
  return staticCount + dynamicCount;
}

function pruneState(options = {}) {
  const root = getStateRoot(options.dataDir);
  const cutoff = (options.now ?? Date.now()) - SESSION_RETENTION_MS;

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const sessionDir = path.join(root, entry.name);
      let newest = 0;
      try {
        newest = fs.statSync(sessionDir).mtimeMs;
        for (const file of fs.readdirSync(sessionDir)) {
          newest = Math.max(
            newest,
            fs.statSync(path.join(sessionDir, file)).mtimeMs,
          );
        }
      } catch {
        // A concurrent writer or cleanup may be changing this directory.
        continue;
      }
      if (newest < cutoff) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }
  } catch {
    // Cleanup is best effort and must never affect a hook.
  }
}

module.exports = {
  SESSION_RETENTION_MS,
  atomicWriteJson,
  countLoadedProfileItems,
  getSessionDir,
  pruneState,
  readState,
  resolveStatuslineDataDir,
  writeState,
};
