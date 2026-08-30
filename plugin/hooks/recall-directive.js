const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { searchMemory } = require('./lib/api');
const { BRAND, gray, red } = require('./lib/colors');
const { getContainerTag } = require('./lib/container-tag');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
  getRecallConfig,
} = require('./lib/settings');
const {
  atomicWriteJson,
  getSessionDir,
  readState,
  writeState,
} = require('./lib/statusline-state');
const { readStdin, writeOutput } = require('./lib/stdin');

// Recall is performed HERE, not delegated to the model: the hook searches
// supermemory with the prompt itself and injects the top matches, so recall
// happens on every substantive prompt instead of only when the model chooses
// to spend a tool call. A configured recallDirective restores advisory mode.
const MIN_PROMPT_LENGTH = 12;
const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS = 5;
const MAX_RESULT_CHARS = 300;
const MIN_SIMILARITY = 0.55;
const SEARCH_TIMEOUT_MS = 3000;
const MAX_SEEN_HASHES = 500;

function shouldSkip(prompt) {
  if (prompt.length < MIN_PROMPT_LENGTH) return true;
  return ['/', '!', '#'].includes(prompt[0]);
}

// Search hits are memory-shaped (.memory) or document/chunk-shaped
// (.chunk/.content/.text, usually with a filepath) — read whichever carries
// the text.
function resultText(r) {
  const text = [r?.memory, r?.chunk, r?.content, r?.text].find(
    (v) => typeof v === 'string' && v.trim(),
  );
  return text || null;
}

// A memory injected once this session stays in the conversation, so
// re-injecting it wastes context and makes the banner repeat the same
// number every turn. The seen set lives next to the statusline state and
// is pruned with it.
function hashText(text) {
  return crypto
    .createHash('sha256')
    .update(text.replace(/\s+/g, ' ').trim())
    .digest('hex')
    .slice(0, 16);
}

function readSeenHashes(sessionDir) {
  try {
    const list = JSON.parse(
      fs.readFileSync(path.join(sessionDir, 'recalled.json'), 'utf8'),
    );
    return Array.isArray(list)
      ? list.filter((h) => typeof h === 'string')
      : [];
  } catch {
    return [];
  }
}

function formatRecall(results, containerTag) {
  const lines = results.map((r) => {
    const text = resultText(r).replace(/\s+/g, ' ').slice(0, MAX_RESULT_CHARS);
    const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : null;
    const prefix = title && !text.startsWith(title) ? `${title} — ` : '';
    return `- ◪ ${prefix}${text}${typeof r.filepath === 'string' && r.filepath ? ` (${r.filepath})` : ''}`;
  });
  return `<supermemory-recall>
◪ Recalled from supermemory for this prompt (relevance-ranked):
${lines.join('\n')}

When one of these shapes your answer, credit it naturally with the ◪ prefix (e.g. "◪ earlier you decided X"); if you name the source, say "from supermemory" — never "from memory". For deeper history, call the supermemory search_memory tool (containerTag: "${containerTag}") or launch the context-gatherer agent.
</supermemory-recall>`;
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const prompt = (input.prompt || '').trim();
    const { directive } = getRecallConfig(cwd);

    if (directive) {
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: directive,
        },
      });
      return;
    }

    if (shouldSkip(prompt)) {
      writeOutput({ continue: true, suppressOutput: true });
      return;
    }

    const projectConfig = loadProjectConfig(cwd);
    let apiKey;
    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      writeOutput({ continue: true, suppressOutput: true });
      return;
    }

    const containerTag = getContainerTag(cwd);
    // Use /v3/search directly — /v4/profile's embedded searchResults is empty
    // on self-hosted backends even when search finds hits (issue #106).
    const response = await searchMemory(
      getBaseUrl(cwd, projectConfig),
      apiKey,
      containerTag,
      prompt.slice(0, MAX_QUERY_LENGTH),
      { timeoutMs: SEARCH_TIMEOUT_MS, limit: MAX_RESULTS },
    );

    const results = (response?.results || [])
      .filter((r) => resultText(r))
      .filter((r) => !Number.isFinite(r.similarity) || r.similarity >= MIN_SIMILARITY)
      .slice(0, MAX_RESULTS);

    const sessionDir = getSessionDir(input.session_id);
    const seen = sessionDir ? readSeenHashes(sessionDir) : [];
    const seenSet = new Set(seen);
    const fresh = results.filter((r) => !seenSet.has(hashText(resultText(r))));
    const repeats = results.length - fresh.length;

    if (input.session_id) {
      const prev = readState(input.session_id).search || {};
      writeState(input.session_id, 'search', {
        results: fresh.length,
        count: (prev.count || 0) + 1,
        memories: (prev.memories || 0) + fresh.length,
      });
    }

    debugLog(settings, 'Prompt recall', {
      query: prompt.slice(0, 80),
      hits: results.length,
      fresh: fresh.length,
    });

    if (fresh.length === 0) {
      writeOutput({ continue: true, suppressOutput: true });
      return;
    }

    if (sessionDir) {
      try {
        atomicWriteJson(
          path.join(sessionDir, 'recalled.json'),
          [...seen, ...fresh.map((r) => hashText(resultText(r)))].slice(-MAX_SEEN_HASHES),
        );
      } catch {
        // Dedup is best effort; recall itself must still go through.
      }
    }

    const context = formatRecall(fresh, containerTag);
    // ~4 chars/token: close enough to show what the injection costs.
    const tok = gray(`(${Math.round(context.length / 4)} tok)`);
    const label = repeats
      ? `recalled ${fresh.length} new ${tok}${gray(` · ${repeats} already in context`)}`
      : `recalled ${fresh.length} ${fresh.length === 1 ? 'memory' : 'memories'} ${tok}`;
    writeOutput({
      systemMessage: `${BRAND} ${gray('·')} ${label}`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    });
  } catch (err) {
    debugLog(settings, 'Recall directive error', { error: err.message });
    writeOutput({
      systemMessage: `${BRAND} ${gray('·')} ${red(`recall failed: ${getUserFriendlyError(err).slice(0, 80)}`)}`,
      continue: true,
      suppressOutput: true,
    });
  }
}

main().catch(() => {
  writeOutput({ continue: true, suppressOutput: true });
});
