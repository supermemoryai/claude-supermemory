const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getProfiles } = require('./lib/api');
const { BRAND, gray, red } = require('./lib/colors');
const { getContainerTag } = require('./lib/container-tag');
const {
  formatRecallContext,
  getRecallContainerTags,
  mergeProfileResults,
  normalizeText,
  resultText,
} = require('./lib/context');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
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
const SEARCH_TIMEOUT_MS = 3000;
const MAX_SEEN_HASHES = 500;

function shouldSkip(prompt) {
  if (prompt.length < MIN_PROMPT_LENGTH) return true;
  return ['/', '!', '#'].includes(prompt[0]);
}

// A memory injected once this session stays in the conversation, so
// re-injecting it wastes context and makes the banner repeat the same
// number every turn. The seen set lives next to the statusline state and
// is pruned with it.
function hashText(text) {
  return crypto
    .createHash('sha256')
    .update(normalizeText(text))
    .digest('hex')
    .slice(0, 16);
}

function readSeenHashes(sessionDir) {
  try {
    const list = JSON.parse(
      fs.readFileSync(path.join(sessionDir, 'recalled.json'), 'utf8'),
    );
    return Array.isArray(list) ? list.filter((h) => typeof h === 'string') : [];
  } catch {
    return [];
  }
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const prompt = (input.prompt || '').trim();
    const projectConfig = loadProjectConfig(cwd);
    const directive =
      projectConfig?.recallDirective || settings.recallDirective || null;

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

    let apiKey;
    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      writeOutput({ continue: true, suppressOutput: true });
      return;
    }

    const containerTag = getContainerTag(cwd);
    const containerTags = getRecallContainerTags(containerTag, settings);
    const responses = await getProfiles(
      getBaseUrl(cwd, projectConfig, apiKey),
      apiKey,
      containerTags,
      prompt.slice(0, MAX_QUERY_LENGTH),
      { timeoutMs: SEARCH_TIMEOUT_MS },
    );
    const results = mergeProfileResults(responses, settings.maxMemories)
      .searchResults.results;

    const sessionDir = getSessionDir(input.session_id);
    const seen = sessionDir ? readSeenHashes(sessionDir) : [];
    const seenSet = new Set(seen);
    const fresh = results.filter(
      (result) => !seenSet.has(hashText(resultText(result))),
    );
    const repeats = results.length - fresh.length;
    const { text: context, newFacts } = formatRecallContext(fresh, {
      containerTag,
      maxTokens: settings.maxPromptRecallTokens,
      customContainers: settings.autoRecallContainers
        ? settings.customContainers
        : [],
    });

    if (input.session_id) {
      const prev = readState(input.session_id).search || {};
      writeState(input.session_id, 'search', {
        results: newFacts.length,
        count: (prev.count || 0) + 1,
        memories: (prev.memories || 0) + newFacts.length,
      });
    }

    debugLog(settings, 'Prompt recall', {
      query: prompt.slice(0, 80),
      containerTags,
      hits: results.length,
      fresh: newFacts.length,
    });

    if (!context) {
      writeOutput({ continue: true, suppressOutput: true });
      return;
    }

    if (sessionDir) {
      try {
        atomicWriteJson(
          path.join(sessionDir, 'recalled.json'),
          [...new Set([...seen, ...newFacts.map(hashText)])].slice(
            -MAX_SEEN_HASHES,
          ),
        );
      } catch {
        // Dedup is best effort; recall itself must still go through.
      }
    }

    // ~4 chars/token: close enough to show what the injection costs.
    const tok = gray(`(${Math.round(context.length / 4)} tok)`);
    const label = repeats
      ? `recalled ${newFacts.length} new ${tok}${gray(` · ${repeats} already in context`)}`
      : `recalled ${newFacts.length} ${newFacts.length === 1 ? 'memory' : 'memories'} ${tok}`;
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
