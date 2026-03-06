/**
 * Shared error utilities for mapping Supermemory SDK errors to user-friendly messages.
 *
 * The SDK (`supermemory` v4.x) attaches a numeric `.status` property to all
 * APIError instances, so we rely on that rather than `instanceof` checks to
 * avoid bundling / import-path issues.
 */

/**
 * Map an SDK error (or any Error) to a concise, actionable message.
 *
 * @param {Error & { status?: number }} err
 * @returns {string}
 */
function getUserFriendlyError(err) {
  const status = err && err.status;

  if (status === 400) {
    return 'Bad request \u2014 your API key or request format may be invalid. Check your key at https://console.supermemory.ai';
  }
  if (status === 401) {
    return 'Authentication failed \u2014 your API key may be expired or revoked. Re-authenticate with the supermemory login command or check https://console.supermemory.ai';
  }
  if (status === 403) {
    return 'Permission denied \u2014 this feature may require a different Supermemory plan. Check https://supermemory.ai/pricing';
  }
  if (status === 429) {
    return 'Rate limited \u2014 too many requests. Will retry next session.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Supermemory service is temporarily unavailable. Will retry next session.';
  }

  return (err && err.message) || 'Unknown error';
}

/**
 * Should the caller consider retrying this request later?
 *
 * Returns true for rate-limit (429), server errors (5xx), and
 * network/connection errors (no HTTP status at all).
 *
 * @param {Error & { status?: number }} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  const status = err && err.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  // Connection / timeout errors have no status
  if (status === undefined || status === null) return true;
  return false;
}

/**
 * Is this error expected / harmless?
 *
 * 404 means the user simply has no data yet. Connection and timeout errors
 * (no HTTP status) are transient network blips.
 *
 * @param {Error & { status?: number }} err
 * @returns {boolean}
 */
function isBenignError(err) {
  const status = err && err.status;
  if (status === 404) return true;
  // No status usually means a connection or timeout error
  if (status === undefined || status === null) return true;
  return false;
}

module.exports = { getUserFriendlyError, isRetryableError, isBenignError };
