const { BRAND, gray } = require('./lib/colors');
const { loadSettings, debugLog } = require('./lib/settings');
const { readState, writeState } = require('./lib/statusline-state');
const { readStdin, writeOutput } = require('./lib/stdin');

// Supermemory MCP tool names arrive as mcp__supermemory__<tool> (direct
// config), mcp__plugin_supermemory_supermemory__<tool> (plugin-scoped), or
// mcp__claude_ai_supermemory__<tool> (claude.ai connector). Only read-only
// tools run without a prompt; writes (add_memory, save-memory, ...) still ask.
const TOOL_NAME_RE =
  /^mcp__(?:plugin_supermemory_|claude_ai_)?supermemory__(.+)$/;
const READ_ONLY_TOOLS = new Set([
  'search_memory',
  'listSpaces',
  'listMemories',
  'listDocuments',
  'getDocument',
  'whoAmI',
  'memory-graph',
  'fetch-graph-data',
]);

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const tool = TOOL_NAME_RE.exec(input.tool_name || '')?.[1];

    if (tool && READ_ONLY_TOOLS.has(tool)) {
      debugLog(settings, 'Auto-approving supermemory recall', { tool });
      const query =
        typeof input.tool_input?.query === 'string'
          ? input.tool_input.query
          : null;
      if (tool === 'search_memory') {
        const prev = readState(input.session_id).search || {};
        writeState(input.session_id, 'search', {
          results: 0,
          count: (prev.count || 0) + 1,
          memories: prev.memories || 0,
        });
      }
      writeOutput({
        systemMessage: query
          ? `${BRAND} ${gray('·')} recalling: ${query}`
          : `${BRAND} ${gray('·')} recalling memories`,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason:
            'Supermemory recall runs automatically (read-only memory access).',
        },
      });
      return;
    }

    writeOutput({ continue: true, suppressOutput: true });
  } catch (err) {
    debugLog(settings, 'Recall approve error', { error: err.message });
    writeOutput({ continue: true, suppressOutput: true });
  }
}

main().catch(() => {
  writeOutput({ continue: true, suppressOutput: true });
});
