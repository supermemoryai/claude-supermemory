const HEADLESS_ENTRYPOINTS = new Set([
  'sdk-cli',
  'sdk-ts',
  'sdk-py',
  'claude-code-github-action',
]);

const ORCHESTRATOR_ENV = [
  'CONDUCTOR_WORKSPACE_PATH',
  'CONDUCTOR_SESSION_ID',
  'VK_WORKSPACE_ID',
];

const TASK_NOTIFICATION_TAG = '<task-notification>';

function isOrchestrated() {
  return ORCHESTRATOR_ENV.some((name) => process.env[name]);
}

// Claude Code records a relayed background-task result as a user turn with origin.kind "task-notification".
function isHostNotificationEntry(entry) {
  return entry?.type === 'user' && entry.origin?.kind === 'task-notification';
}

// Host signals only: hook agent_id, the task-notification turn, CLAUDE_CODE_ENTRYPOINT, orchestrator env.
function getSkipReason(input, settings) {
  const orchestrated = isOrchestrated();
  if (orchestrated && !settings.captureOrchestrated) return 'orchestrated';
  if (!settings.captureSubagents) {
    if (input?.agent_id) return 'subagent';
    if (
      typeof input?.prompt === 'string' &&
      input.prompt.trimStart().startsWith(TASK_NOTIFICATION_TAG)
    ) {
      return 'subagent';
    }
  }
  if (
    !orchestrated &&
    !settings.captureHeadless &&
    HEADLESS_ENTRYPOINTS.has(process.env.CLAUDE_CODE_ENTRYPOINT)
  ) {
    return 'headless';
  }
  return null;
}

module.exports = { getSkipReason, isHostNotificationEntry };
