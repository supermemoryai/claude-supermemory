const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SESSIONS_DIR = path.join(os.homedir(), '.supermemory-claude', 'sessions');

// Prune session files older than this so they don't accumulate forever.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// Cap the per-session set so a very long session can't grow it unbounded.
// The Set preserves insertion order, so the most recently seen keys are kept.
const MAX_KEYS = 500;

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionFile(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

// Normalize a memory string into a dedup token (matches the client's dedupe).
function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .trim();
}

// Stable dedup keys for a memory. A memory matches if ANY of its keys are
// already seen: prefer the document id, and always include a content hash so
// the same text dedupes even when no id is present (e.g. profile facts).
function memoryKeys(item = {}) {
  const keys = [];
  if (item.id) keys.push(`id:${item.id}`);
  const norm = normalizeKey(item.memory);
  if (norm) {
    const hash = crypto
      .createHash('sha256')
      .update(norm)
      .digest('hex')
      .slice(0, 16);
    keys.push(`c:${hash}`);
  }
  return keys;
}

function isSeen(seen, keys) {
  return keys.some((k) => seen.has(k));
}

function loadSeen(sessionId) {
  if (!sessionId) return new Set();
  try {
    const file = sessionFile(sessionId);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(data.seen)) return new Set(data.seen);
    }
  } catch {}
  return new Set();
}

function saveSeen(sessionId, seen) {
  if (!sessionId) return;
  try {
    ensureDir();
    let keys = Array.from(seen);
    if (keys.length > MAX_KEYS) {
      keys = keys.slice(keys.length - MAX_KEYS);
    }
    fs.writeFileSync(
      sessionFile(sessionId),
      JSON.stringify({ seen: keys, updatedAt: new Date().toISOString() }),
    );
  } catch {}
}

// Union the given keys into the persisted set without clobbering existing
// entries. Used to seed the profile at SessionStart (which re-fires on
// resume/compact with the same session id) and to record injected memories
// each turn. Returns the merged set.
function mergeSeen(sessionId, keys) {
  const seen = loadSeen(sessionId);
  let changed = false;
  for (const k of keys) {
    if (k && !seen.has(k)) {
      seen.add(k);
      changed = true;
    }
  }
  if (changed) saveSeen(sessionId, seen);
  return seen;
}

// Opportunistically delete stale session files.
function pruneOldSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(SESSIONS_DIR)) {
      const file = path.join(SESSIONS_DIR, name);
      try {
        const stat = fs.statSync(file);
        if (now - stat.mtimeMs > MAX_AGE_MS) fs.unlinkSync(file);
      } catch {}
    }
  } catch {}
}

module.exports = {
  SESSIONS_DIR,
  normalizeKey,
  memoryKeys,
  isSeen,
  loadSeen,
  saveSeen,
  mergeSeen,
  pruneOldSessions,
};
