// Numeric status is the stable field; error classes differ across SDK builds.
function getUserFriendlyError(err) {
  const status = err?.status ?? err?.statusCode;

  if (
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    err?.name === 'SupermemoryTimeoutError' ||
    (err?.name === 'SupermemoryError' && status == null) ||
    err?.message === 'fetch failed'
  ) {
    return 'Supermemory unreachable (network) — continuing without memory.';
  }
  if (status === 400) {
    return 'Bad request \u2014 your API key or request format may be invalid. Check your key at https://console.supermemory.ai';
  }
  if (status === 401) {
    return 'Authentication failed \u2014 your API key may be expired or revoked. Re-authenticate with the supermemory login command or check https://console.supermemory.ai';
  }
  if (status === 402) {
    return 'Out of credits \u2014 top up at https://console.supermemory.ai to continue saving.';
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
  if (typeof status === 'number') {
    return `Supermemory API returned HTTP ${status}.`;
  }

  return err?.message || 'Unknown error';
}

function isRetryableError(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (status === undefined || status === null) return true;
  return false;
}

function isBenignError(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 404) return true;
  if (status === undefined || status === null) return true;
  return false;
}

module.exports = { getUserFriendlyError, isRetryableError, isBenignError };
