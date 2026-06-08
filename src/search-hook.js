const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getRepoContainerTag } = require('./lib/container-tag');
const {
  loadSettings,
  getApiKey,
  getSearchConfig,
  debugLog,
} = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatContext } = require('./lib/format-context');
const { isBenignError } = require('./lib/error-helpers');
const {
  loadSeen,
  memoryKeys,
  isSeen,
  mergeSeen,
} = require('./lib/session-set');

const MAX_QUERY_LENGTH = 1500;
const SEARCH_TIMEOUT_MS = 8000;

// Race a promise against a timeout, clearing the timer so a fast result lets
// the process exit immediately instead of waiting out the timeout.
function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const prompt = String(input.prompt || '').trim();

    const config = getSearchConfig(cwd);
    if (!config.enabled) {
      writeOutput({ continue: true });
      return;
    }

    // Skip non-query prompts (empty or slash commands).
    if (!prompt || prompt.startsWith('/')) {
      writeOutput({ continue: true });
      return;
    }

    // No key: stay silent and fast. SessionStart owns the auth flow.
    let apiKey;
    try {
      apiKey = getApiKey(settings, cwd);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    const query = prompt.slice(0, MAX_QUERY_LENGTH);
    const tags = [getContainerTag(cwd), getRepoContainerTag(cwd)];

    const client = new SupermemoryClient(apiKey);

    const searches = tags.map((tag) =>
      client
        .search(query, tag, { limit: config.limit })
        .then((r) => r.results || [])
        .catch((err) => {
          if (!isBenignError(err)) {
            debugLog(settings, 'Search error', {
              tag,
              message: err.message,
            });
          }
          return [];
        }),
    );

    const settled = await withTimeout(
      Promise.all(searches),
      SEARCH_TIMEOUT_MS,
      [],
    );
    const all = settled.flat();

    if (all.length === 0) {
      writeOutput({ continue: true });
      return;
    }

    // Dedup against the session set and within this turn.
    const seen = loadSeen(sessionId);
    const turnSeen = new Set();
    const fresh = [];

    for (const item of all) {
      const keys = memoryKeys(item);
      if (keys.length === 0) continue;
      if (isSeen(seen, keys) || isSeen(turnSeen, keys)) continue;
      for (const k of keys) turnSeen.add(k);
      fresh.push(item);
    }

    if (fresh.length === 0) {
      writeOutput({ continue: true });
      return;
    }

    // Highest relevance first, then cap to keep injected context lean.
    fresh.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    const injected = fresh.slice(0, config.limit);

    const additionalContext = formatContext(
      { searchResults: { results: injected } },
      false, // includeProfile
      true, // includeRelevantMemories
      config.limit,
      true, // wrapWithTags
    );

    if (!additionalContext) {
      writeOutput({ continue: true });
      return;
    }

    // Record injected memories so they don't repeat on later turns.
    const injectedKeys = injected.flatMap((item) => memoryKeys(item));
    mergeSeen(sessionId, injectedKeys);

    debugLog(settings, 'Per-message search injected', {
      count: injected.length,
      promptLength: prompt.length,
    });

    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    });
  } catch (err) {
    debugLog(settings, 'search-hook error', { error: err.message });
    writeOutput({ continue: true });
  }
}

main().catch(() => {
  // Fail open: never block the prompt on a retrieval error.
  process.exit(0);
});
