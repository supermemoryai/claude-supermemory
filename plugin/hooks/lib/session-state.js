const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

function getSessionDir(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  return path.join(
    os.homedir(),
    '.supermemory-claude',
    'statusline',
    'statusline-state',
    crypto.createHash('sha256').update(sessionId.trim()).digest('hex'),
  );
}

function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
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
    } catch {}
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function writeState(sessionId, event, data = {}) {
  if (!['context', 'capture', 'search'].includes(event)) return false;
  const sessionDir = getSessionDir(sessionId);
  if (!sessionDir) return false;
  let fields;
  if (event === 'context') {
    fields = {
      status: ['loading', 'ready', 'error'].includes(data.status)
        ? data.status
        : 'ready',
      memoryItemsLoaded: normalizeCount(data.memoryItemsLoaded),
    };
  } else if (event === 'capture') {
    fields = {
      status: ['saving', 'saved', 'error'].includes(data.status)
        ? data.status
        : 'error',
      count: normalizeCount(data.count),
    };
  } else {
    fields = {
      results: normalizeCount(data.results),
      count: normalizeCount(data.count),
      memories: normalizeCount(data.memories),
    };
  }
  try {
    atomicWriteJson(path.join(sessionDir, `${event}.json`), {
      version: SCHEMA_VERSION,
      event,
      updatedAt: Date.now(),
      ...fields,
    });
    return true;
  } catch {
    return false;
  }
}

function readState(sessionId, event) {
  const sessionDir = getSessionDir(sessionId);
  if (!sessionDir) return null;
  try {
    const record = JSON.parse(
      fs.readFileSync(path.join(sessionDir, `${event}.json`), 'utf8'),
    );
    return record?.version === SCHEMA_VERSION && record?.event === event
      ? record
      : null;
  } catch {
    return null;
  }
}

function pruneState() {
  const root = path.join(
    os.homedir(),
    '.supermemory-claude',
    'statusline',
    'statusline-state',
  );
  const cutoff = Date.now() - SESSION_RETENTION_MS;

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
        continue;
      }
      if (newest < cutoff)
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch {}
}

function captureNoticePath() {
  return path.join(os.homedir(), '.supermemory-claude', 'capture-notice.json');
}

function writeCaptureNotice(message) {
  const text = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  if (!text) return false;
  try {
    atomicWriteJson(captureNoticePath(), { message: text });
    return true;
  } catch {
    return false;
  }
}

function readCaptureNotice() {
  try {
    const record = JSON.parse(fs.readFileSync(captureNoticePath(), 'utf8'));
    if (typeof record?.message !== 'string' || !record.message.trim()) return null;
    return { message: record.message.trim() };
  } catch {
    return null;
  }
}

function clearCaptureNotice() {
  try {
    fs.unlinkSync(captureNoticePath());
  } catch {}
}

module.exports = {
  atomicWriteJson,
  clearCaptureNotice,
  getSessionDir,
  pruneState,
  readCaptureNotice,
  readState,
  writeCaptureNotice,
  writeState,
};
