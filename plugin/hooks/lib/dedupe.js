const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteJson } = require('./session-state');

const STATE_DIR = path.join(os.homedir(), '.supermemory-claude');
const OPENING_PROMPTS_FILE = path.join(STATE_DIR, 'opening-prompts.json');
const RECALL_CACHE_FILE = path.join(STATE_DIR, 'recall-cache.json');
const MAX_OPENING_PROMPTS = 500;
const MAX_RECALL_CACHE = 50;
const MIN_OPENING_PROMPT_LENGTH = 200;
const OPENING_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;
const RECALL_WINDOW_MS = 10 * 60 * 1000;

function hashKey(...parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function readIndex(file, ttlMs) {
  const cutoff = Date.now() - ttlMs;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list)
      ? list.filter(
          (item) =>
            typeof item?.key === 'string' &&
            Number.isFinite(item.at) &&
            item.at >= cutoff,
        )
      : [];
  } catch {
    return [];
  }
}

function writeIndex(file, list, max) {
  try {
    atomicWriteJson(file, list.slice(-max));
  } catch {}
}

function openingPromptKey(containerTag, text) {
  const normalized = normalize(text);
  return normalized.length >= MIN_OPENING_PROMPT_LENGTH
    ? hashKey(containerTag, normalized)
    : null;
}

function hasOpeningPrompt(containerTag, text) {
  const key = openingPromptKey(containerTag, text);
  return Boolean(
    key &&
      readIndex(OPENING_PROMPTS_FILE, OPENING_PROMPT_TTL_MS).some(
        (item) => item.key === key,
      ),
  );
}

function rememberOpeningPrompt(containerTag, text) {
  const key = openingPromptKey(containerTag, text);
  if (!key) return;
  const list = readIndex(OPENING_PROMPTS_FILE, OPENING_PROMPT_TTL_MS).filter(
    (item) => item.key !== key,
  );
  list.push({ key, at: Date.now() });
  writeIndex(OPENING_PROMPTS_FILE, list, MAX_OPENING_PROMPTS);
}

// Only another session's identical query is served from cache, so a user retrying in one session still gets fresh results.
function cachedRecall(containerTag, query, sessionId) {
  const key = hashKey(containerTag, normalize(query));
  const session = hashKey(String(sessionId || ''));
  const hit = readIndex(RECALL_CACHE_FILE, RECALL_WINDOW_MS).find(
    (item) =>
      item.key === key &&
      item.session !== session &&
      Array.isArray(item.results),
  );
  return hit ? hit.results : null;
}

function cacheRecall(containerTag, query, sessionId, results) {
  const key = hashKey(containerTag, normalize(query));
  const list = readIndex(RECALL_CACHE_FILE, RECALL_WINDOW_MS).filter(
    (item) => item.key !== key,
  );
  list.push({
    key,
    session: hashKey(String(sessionId || '')),
    at: Date.now(),
    results,
  });
  writeIndex(RECALL_CACHE_FILE, list, MAX_RECALL_CACHE);
}

module.exports = {
  hasOpeningPrompt,
  rememberOpeningPrompt,
  cachedRecall,
  cacheRecall,
};
