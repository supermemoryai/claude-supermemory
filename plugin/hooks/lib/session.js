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
  return {
    offset: bootstrapOffset(fd, size, sessionId),
    generation: 0,
    headHash: '',
  };
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

// Drops fully private and host-notification turns and redacts the rest; a reply missing from the file is sent from the Stop input and skipped when it lands.
function filterRecords(lines, cursor, options) {
  let hidden = Boolean(cursor.hidden);
  let pendingReply = cursor.pendingReply || '';
  let lastReply = cursor.lastReply || '';
  const kept = [];
  for (const line of lines) {
    const entry = parseLine(line);
    if (!entry) {
      if (!hidden) kept.push(redactText(line));
      continue;
    }
    if (startsTurn(entry)) {
      hidden =
        isFullyPrivate(getTextFromEntry(entry)) ||
        (!options.captureSubagents && isHostNotificationEntry(entry));
      pendingReply = '';
    }
    if (hidden) continue;
    if (entry.type === 'assistant') {
      const text = replyText(entry);
      if (text) {
        const hash = sha256(text);
        lastReply = hash;
        if (hash === pendingReply) {
          pendingReply = '';
          continue;
        }
      }
    }
    kept.push(JSON.stringify(entry, redactValue));
  }

  const finalText = cleanContent(options.lastAssistantMessage);
  if (finalText && !hidden && sha256(finalText) !== lastReply) {
    kept.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: redactText(options.lastAssistantMessage) }],
        },
      }),
    );
    pendingReply = sha256(finalText);
    lastReply = pendingReply;
  }
  return { kept, hidden, pendingReply, lastReply };
}

function readRawDelta(transcriptPath, sessionId, options = {}) {
  if (!fs.existsSync(transcriptPath)) return null;
  const destination = options.destination || '';
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const prev = readCursor(fd, size, sessionId, destination);
    let offset = prev.offset;
    let generation = prev.generation;
    let state = prev;

    const consumedHead = hashPrefix(fd, Math.min(HEAD_BYTES, prev.offset));
    if (size < prev.offset || (prev.headHash && prev.headHash !== consumedHead)) {
      offset = 0;
      generation = prev.generation + 1;
      state = {};
    }

    let lines = [];
    let nextOffset = offset;
    if (size > offset) {
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, size - offset, offset);
      const lastNewline = buf.lastIndexOf(0x0a);
      if (lastNewline !== -1) {
        lines = buf
          .subarray(0, lastNewline)
          .toString('utf8')
          .split('\n')
          .filter((line) => line.trim());
        nextOffset = offset + lastNewline + 1;
      }
    }

    const { kept, hidden, pendingReply, lastReply } = filterRecords(
      lines,
      state,
      options,
    );
    if (nextOffset === offset && kept.length === 0) return null;
    const nextHead = hashPrefix(fd, Math.min(HEAD_BYTES, nextOffset));

    return {
      raw: kept.length > 0 ? `${kept.join('\n')}\n` : '',
      generation,
      offset,
      commit: () =>
        atomicWriteJson(cursorPath(sessionId, destination), {
          offset: nextOffset,
          generation,
          headHash: nextHead,
          hidden,
          pendingReply,
          lastReply,
        }),
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readRawDelta };
