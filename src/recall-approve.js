const { loadSettings, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');

// ---------------------------------------------------------------------------
// Auto-approve reasoned recall (PreToolUse).
//
// Reasoned recall is decided by the model, but it executes through the
// supermemory-search skill — a tool call, which normally triggers a permission
// prompt. The save path (Stop hook) runs silently; recall should feel the same.
//
// This PreToolUse hook returns `permissionDecision: "allow"` ONLY for the
// supermemory search (the skill, or a clean `node … search-memory.cjs` Bash
// call). Every other tool — and any search command laced with shell
// chaining/redirection — falls through to the normal permission flow untouched.
// ---------------------------------------------------------------------------

// Matches a Bash command that actually *runs* the search script (not, say,
// `rm search-memory.cjs`) — requires a `node` invocation ahead of the script.
const SEARCH_BASH_RE = /node[\s\S]*search-memory\.cjs/;
// Refuse to auto-approve if the command chains/redirects to anything else,
// so a laced command like `node …search-memory.cjs; rm -rf ~` still prompts.
const SHELL_OPS = /[;&|`>]|\$\(/;
const SEARCH_SKILL = 'supermemory-search';

function isSupermemorySearch(toolName, toolInput) {
  if (toolName === 'Skill') {
    return JSON.stringify(toolInput || {}).includes(SEARCH_SKILL);
  }
  if (toolName === 'Bash') {
    const cmd = String(toolInput?.command || '');
    return SEARCH_BASH_RE.test(cmd) && !SHELL_OPS.test(cmd);
  }
  return false;
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();

    if (isSupermemorySearch(input.tool_name, input.tool_input)) {
      debugLog(settings, 'Auto-approving recall search', {
        toolName: input.tool_name,
      });
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason:
            'Supermemory reasoned recall runs automatically (read-only memory search).',
        },
      });
      return;
    }

    // Not our search — don't touch the normal permission flow.
    writeOutput({ continue: true, suppressOutput: true });
  } catch (err) {
    debugLog(settings, 'Recall approve hook error', { error: err.message });
    writeOutput({ continue: true, suppressOutput: true });
  }
}

main().catch(() => {
  writeOutput({ continue: true, suppressOutput: true });
});
