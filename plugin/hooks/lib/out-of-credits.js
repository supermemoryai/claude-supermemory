const fs = require('node:fs');
const path = require('node:path');
const { BRAND, gray } = require('./colors');
const { atomicWriteJson, getSessionDir } = require('./session-state');

const BILLING_URL = 'https://console.supermemory.ai/billing';
const MARKER = 'out-of-credits-notice.json';
const DEFAULT_DETAILS = "You've run out of credits. Top up to continue.";

function refusalDetails(err) {
  if (typeof err?.body?.details === 'string') return err.body.details;
  try {
    const body = JSON.parse(String(err?.message).replace(/^Supermemory API \d+: /, ''));
    if (typeof body?.details === 'string') return body.details;
  } catch {}
  return DEFAULT_DETAILS;
}

// The API refuses recall with 402 at $0 credits; a per-session marker keeps it to one line instead of a banner on every prompt.
function outOfCreditsNotice(sessionId, err) {
  if ((err?.status ?? err?.statusCode) !== 402) return undefined;
  const dir = getSessionDir(sessionId);
  if (dir) {
    const marker = path.join(dir, MARKER);
    if (fs.existsSync(marker)) return null;
    try {
      atomicWriteJson(marker, { shownAt: new Date().toISOString() });
    } catch {}
  }
  return `${BRAND} ${gray('·')} recall paused ${gray('·')} ${refusalDetails(err)} ${BILLING_URL}`;
}

module.exports = { outOfCreditsNotice };
