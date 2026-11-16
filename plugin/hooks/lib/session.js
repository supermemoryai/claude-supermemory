const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { atomicWriteJson } = require('./session-state');

const SESSION_DIR = path.join(os.homedir(), '.supermemory-claude', 'session');
const HEAD_BYTES = 4096;

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function cursorPath(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

function readCursor(sessionId) {
  try {
    const cursor = JSON.parse(fs.readFileSync(cursorPath(sessionId), 'utf8'));
    if (
      typeof cursor.offset === 'number' &&
      typeof cursor.generation === 'number'
    ) {
      return cursor;
    }
  } catch {}
  return { offset: 0, generation: 0, headHash: '' };
}

// Hash of the first `len` bytes. The caller hashes only the already-consumed
// prefix, which is stable while the file is appended to and only changes when
// the file is rewritten or truncated.
function hashPrefix(fd, len) {
  if (len <= 0) return '';
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, 0);
  return createHash('sha256').update(buf).digest('hex');
}

function readRawDelta(transcriptPath, sessionId) {
  if (!fs.existsSync(transcriptPath)) return null;
  ensureDir();
  const prev = readCursor(sessionId);
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let offset = prev.offset;
    let generation = prev.generation;

    const consumedHead = hashPrefix(fd, Math.min(HEAD_BYTES, prev.offset));
    if (size < prev.offset || (prev.headHash && prev.headHash !== consumedHead)) {
      offset = 0;
      generation = prev.generation + 1;
    }

    if (size <= offset) return null;
    const len = size - offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1) return null;
    const raw = buf.subarray(0, lastNewline + 1).toString('utf8');
    const nextOffset = offset + lastNewline + 1;
    const nextHead = hashPrefix(fd, Math.min(HEAD_BYTES, nextOffset));

    return {
      raw,
      generation,
      offset,
      commit: () =>
        atomicWriteJson(cursorPath(sessionId), {
          offset: nextOffset,
          generation,
          headHash: nextHead,
        }),
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readRawDelta };
