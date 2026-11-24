const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { atomicWriteJson } = require('./session-state');
const { redactSecrets } = require('./redact');
const { isHostNotificationEntry } = require('./session-scope');
const {
  cleanContent,
  getLastCapturedUuid,
  getTextFromEntry,
} = require('./transcript');

const SESSION_DIR = path.join(os.homedir(), '.supermemory-claude', 'session');
const HEAD_BYTES = 4096;
const LOCK_RETRY_MS = 50;
const LOCK_WAIT_MS = 25000;
const LOCK_STALE_MS = 35000;
const MAX_CHUNK_BYTES = 256 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_STRING_CHARS = 16 * 1024;
const MAX_SKIPPED_RANGES = 20;
const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/gi;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function redactText(text) {
  return redactSecrets(text.replace(PRIVATE_BLOCK, '[REDACTED]'));
}

function isFullyPrivate(text) {
  const stripped = text.replace(PRIVATE_BLOCK, '').trim();
  return text.trim().length > 0 && stripped === '';
}

function redactValue(_key, value) {
  return typeof value === 'string' ? redactText(value) : value;
}

// "[Request interrupted by user…]" markers stay in the turn they interrupt.
function startsTurn(entry) {
  if (entry?.type !== 'user' || entry.isMeta) return false;
  const text = getTextFromEntry(entry);
  return text.length > 0 && !text.startsWith('[Request interrupted by user');
}

function replyText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return cleanContent(content);
  if (!Array.isArray(content)) return '';
  if (content.some((block) => block.type === 'tool_use')) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => cleanContent(block.text))
    .join('\n');
}

// Keyed by destination too, so a send accepted by one backend or namespace never hides history from another.
function cursorPath(sessionId, destination) {
  return path.join(
    SESSION_DIR,
    `${sessionId}.${sha256(destination).slice(0, 16)}.json`,
  );
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Without a cursor, start after the legacy UUID tracker, or at the latest turn, so pre-install history is never uploaded.
function bootstrapOffset(fd, size, sessionId) {
  if (size === 0) return 0;
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, 0);
  const lastUuid = getLastCapturedUuid(sessionId);
  let latestTurn = 0;
  let start = 0;
  while (start < size) {
    const newline = buf.indexOf(0x0a, start);
    if (newline === -1) break;
    const entry = parseLine(buf.subarray(start, newline).toString('utf8'));
    if (lastUuid && entry?.uuid === lastUuid) return newline + 1;
    if (startsTurn(entry)) latestTurn = start;
    start = newline + 1;
  }
  return latestTurn;
}

function readCursor(fd, size, sessionId, destination) {
  try {
    const cursor = JSON.parse(
      fs.readFileSync(cursorPath(sessionId, destination), 'utf8'),
    );
    if (
      typeof cursor.offset === 'number' &&
      typeof cursor.generation === 'number'
    ) {
      return cursor;
    }
  } catch {}
  const offset = bootstrapOffset(fd, size, sessionId);
  const cursor = {
    offset,
    generation: 0,
    headHash: hashPrefix(fd, Math.min(HEAD_BYTES, offset)),
  };
  atomicWriteJson(cursorPath(sessionId, destination), cursor);
  return cursor;
}

// Hash of the first `len` bytes. The caller hashes only the already-consumed
// prefix, which is stable while the file is appended to and only changes when
// the file is rewritten or truncated.
function hashPrefix(fd, len) {
  if (len <= 0) return '';
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, 0);
  return sha256(buf);
}

function truncateString(text) {
  return text.length > MAX_RECORD_STRING_CHARS
    ? `${text.slice(0, MAX_RECORD_STRING_CHARS)}…[truncated ${text.length - MAX_RECORD_STRING_CHARS} chars]`
    : text;
}

function truncateValue(_key, value) {
  return typeof value === 'string' ? truncateString(redactText(value)) : value;
}

// A record too big for one request keeps its JSON shape with long strings cut, so the turn is still captured.
function fitRecord(entry) {
  const text = typeof entry === 'string' ? redactText(entry) : JSON.stringify(entry, redactValue);
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_CHUNK_BYTES) return { text, truncatedBytes: 0 };
  const cut = typeof entry === 'string' ? truncateString(text) : JSON.stringify(entry, truncateValue);
  return { text: cut, truncatedBytes: bytes - Buffer.byteLength(cut) };
}

// Drops fully private and host-notification turns and redacts the rest; a reply missing from the file is sent from the Stop input and skipped when it lands.
function filterLine(line, state, options) {
  const entry = parseLine(line);
  if (!entry) return state.hidden ? null : fitRecord(line);
  if (startsTurn(entry)) {
    state.hidden =
      isFullyPrivate(getTextFromEntry(entry)) ||
      (!options.captureSubagents && isHostNotificationEntry(entry));
    state.pendingReply = '';
  }
  if (state.hidden) return null;
  if (entry.type === 'assistant') {
    const text = replyText(entry);
    if (text) {
      const hash = sha256(text);
      state.lastReply = hash;
      if (hash === state.pendingReply) {
        state.pendingReply = '';
        return null;
      }
    }
  }
  return fitRecord(entry);
}

function findNewline(fd, from, size) {
  const block = Buffer.alloc(64 * 1024);
  for (let position = from; position < size; position += block.length) {
    const read = fs.readSync(fd, block, 0, Math.min(block.length, size - position), position);
    const index = block.subarray(0, read).indexOf(0x0a);
    if (index !== -1) return position + index;
  }
  return -1;
}

// Splits the bytes appended since the last accepted send into whole-line chunks, reading at most MAX_READ_BYTES per Stop, so an outage or one huge turn never builds a request the server can't take.
function readRawChunks(transcriptPath, sessionId, options = {}) {
  if (!fs.existsSync(transcriptPath)) return [];
  const destination = options.destination || '';
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const prev = readCursor(fd, size, sessionId, destination);
    let offset = prev.offset;
    let generation = prev.generation;
    let base = prev;

    const consumedHead = hashPrefix(fd, Math.min(HEAD_BYTES, prev.offset));
    if (size < prev.offset || (prev.headHash && prev.headHash !== consumedHead)) {
      offset = 0;
      generation = prev.generation + 1;
      base = {};
    }
    const state = {
      hidden: Boolean(base.hidden),
      pendingReply: base.pendingReply || '',
      lastReply: base.lastReply || '',
    };
    const skipped = Array.isArray(prev.skipped) ? [...prev.skipped] : [];
    const cursorFile = cursorPath(sessionId, destination);
    const chunks = [];
    const pushChunk = (start, end, lines, snapshot, truncatedBytes = 0, oversizedBytes = 0) => {
      const headHash = hashPrefix(fd, Math.min(HEAD_BYTES, end));
      chunks.push({
        raw: lines.length > 0 ? `${lines.join('\n')}\n` : '',
        generation,
        offset: start,
        end,
        truncatedBytes,
        oversizedBytes,
        commit: (skipReason) => {
          if (skipReason) {
            skipped.push({ generation, offset: start, end, reason: skipReason });
            skipped.splice(0, Math.max(0, skipped.length - MAX_SKIPPED_RANGES));
          }
          atomicWriteJson(cursorFile, {
            offset: end,
            generation,
            headHash,
            ...snapshot,
            ...(skipped.length > 0 ? { skipped } : {}),
          });
        },
      });
    };

    const len = Math.min(size - offset, MAX_READ_BYTES);
    const buf = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buf, 0, len, offset);
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1 && len === MAX_READ_BYTES) {
      const lineEnd = findNewline(fd, offset + len, size);
      if (lineEnd !== -1) {
        pushChunk(offset, lineEnd + 1, [], { ...state }, 0, lineEnd + 1 - offset);
      }
      return chunks;
    }

    let chunkStart = offset;
    let chunkLines = [];
    let chunkBytes = 0;
    let chunkTruncated = 0;
    const add = (kept, at, before) => {
      const bytes = Buffer.byteLength(kept.text) + 1;
      if (chunkLines.length > 0 && chunkBytes + bytes > MAX_CHUNK_BYTES) {
        pushChunk(chunkStart, at, chunkLines, before, chunkTruncated);
        chunkStart = at;
        chunkLines = [];
        chunkBytes = 0;
        chunkTruncated = 0;
      }
      chunkLines.push(kept.text);
      chunkBytes += bytes;
      chunkTruncated += kept.truncatedBytes;
    };
    for (let lineStart = 0; lineStart <= lastNewline; ) {
      const newline = buf.indexOf(0x0a, lineStart);
      const lineOffset = offset + lineStart;
      const line = buf.subarray(lineStart, newline).toString('utf8');
      lineStart = newline + 1;
      if (!line.trim()) continue;
      const before = { ...state };
      const kept = filterLine(line, state, options);
      if (kept) add(kept, lineOffset, before);
    }
    const end = offset + lastNewline + 1;

    const finalText =
      len === size - offset ? cleanContent(options.lastAssistantMessage) : '';
    if (finalText && !state.hidden && sha256(finalText) !== state.lastReply) {
      const before = { ...state };
      state.pendingReply = sha256(finalText);
      state.lastReply = state.pendingReply;
      add(
        fitRecord({
          type: 'assistant',
          message: { content: [{ type: 'text', text: options.lastAssistantMessage }] },
        }),
        end,
        before,
      );
    }
    if (end === offset && chunkLines.length === 0) return chunks;
    pushChunk(chunkStart, end, chunkLines, { ...state }, chunkTruncated);
    return chunks;
  } finally {
    fs.closeSync(fd);
  }
}

// Async Stop hooks can overlap; holding the lock across read, upload and commit stops a slower upload from rewinding the cursor.
async function withSessionLock(sessionId, action) {
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  const lockFile = path.join(SESSION_DIR, `${sessionId}.lock`);
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      fs.closeSync(fs.openSync(lockFile, 'wx'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch {}
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    await action();
    return true;
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }
}

module.exports = { readRawChunks, withSessionLock };
