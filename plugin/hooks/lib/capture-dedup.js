// /v3/documents appends per customId. After a client timeout the server may
// already hold a prefix of the pending delta; resending the overlap duplicates
// content and billing (issue #130).

function longestAppendOverlap(stored, pending) {
  if (typeof stored !== 'string' || typeof pending !== 'string') return 0;
  if (!stored.length || !pending.length) return 0;
  const max = Math.min(stored.length, pending.length);
  for (let len = max; len > 0; len -= 1) {
    if (stored.endsWith(pending.slice(0, len))) return len;
  }
  return 0;
}

function trimForAppend(storedContent, pendingContent) {
  if (typeof pendingContent !== 'string') return '';
  const stored = typeof storedContent === 'string' ? storedContent : '';
  const overlap = longestAppendOverlap(stored, pendingContent);
  if (overlap === 0) return pendingContent;
  return pendingContent.slice(overlap).replace(/^\n+/, '');
}

function isAlreadyStored(storedContent, pendingContent) {
  const trimmed = trimForAppend(storedContent, pendingContent);
  return trimmed.trim().length === 0 && pendingContent.trim().length > 0;
}

module.exports = {
  longestAppendOverlap,
  trimForAppend,
  isAlreadyStored,
};
