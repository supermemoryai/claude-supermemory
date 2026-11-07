const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteJson } = require('./session-state');

const STATE_DIR = path.join(os.homedir(), '.supermemory-claude');
const OPENING_PROMPTS_FILE = path.join(STATE_DIR, 'opening-prompts.json');
const RECALL_QUERIES_FILE = path.join(STATE_DIR, 'recall-queries.json');
const MAX_OPENING_PROMPTS = 500;
const MAX_RECALL_QUERIES = 200;
const RECALL_WINDOW_MS = 10 * 60 * 1000;

function hashKey(...parts) {
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function readIndex(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list)
      ? list.filter(
          (item) => typeof item?.key === 'string' && Number.isFinite(item.at),
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

function hasOpeningPrompt(containerTag, text) {
  const key = hashKey(containerTag, normalize(text));
  return readIndex(OPENING_PROMPTS_FILE).some((item) => item.key === key);
}

function rememberOpeningPrompt(containerTag, text) {
  const key = hashKey(containerTag, normalize(text));
  const list = readIndex(OPENING_PROMPTS_FILE).filter(
    (item) => item.key !== key,
  );
  list.push({ key, at: Date.now() });
  writeIndex(OPENING_PROMPTS_FILE, list, MAX_OPENING_PROMPTS);
}

// Only another session's identical query counts, so a user retrying in one session still recalls.
function recalledElsewhere(containerTag, query, sessionId) {
  const key = hashKey(containerTag, normalize(query));
  const session = hashKey(String(sessionId || ''));
  const cutoff = Date.now() - RECALL_WINDOW_MS;
  return readIndex(RECALL_QUERIES_FILE).some(
    (item) => item.key === key && item.at >= cutoff && item.session !== session,
  );
}

function rememberRecallQuery(containerTag, query, sessionId) {
  const key = hashKey(containerTag, normalize(query));
  const session = hashKey(String(sessionId || ''));
  const cutoff = Date.now() - RECALL_WINDOW_MS;
  const list = readIndex(RECALL_QUERIES_FILE).filter(
    (item) =>
      item.at >= cutoff && !(item.key === key && item.session === session),
  );
  list.push({ key, session, at: Date.now() });
  writeIndex(RECALL_QUERIES_FILE, list, MAX_RECALL_QUERIES);
}

module.exports = {
  hasOpeningPrompt,
  rememberOpeningPrompt,
  recalledElsewhere,
  rememberRecallQuery,
};
