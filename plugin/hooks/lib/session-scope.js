const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ORCHESTRATOR_ENV = [
  'CONDUCTOR_WORKSPACE_PATH',
  'CONDUCTOR_SESSION_ID',
  'VK_WORKSPACE_ID',
];

const TASK_NOTIFICATION_TAG = '<task-notification>';
const USER_AUTHORED_SUBKINDS = new Set(['scheduled-trigger', 'session-inbox']);
const PRINT_FLAGS = new Set(['-p', '--print']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish']);
const VALUE_OPTIONS = new Set([
  '--add-dir',
  '--agent',
  '--agents',
  '--allowedTools',
  '--allowed-tools',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--betas',
  '--debug-file',
  '--disallowedTools',
  '--disallowed-tools',
  '--effort',
  '--fallback-model',
  '--input-format',
  '--json-schema',
  '--max-budget-usd',
  '--max-turns',
  '--mcp-config',
  '--model',
  '-n',
  '--name',
  '--output-format',
  '--permission-mode',
  '--permission-prompt-tool',
  '--plugin-dir',
  '--session-id',
  '--setting-sources',
  '--settings',
  '--system-prompt',
  '--system-prompt-file',
  '--tools',
]);

function isOrchestrated() {
  return ORCHESTRATOR_ENV.some((name) => process.env[name]);
}

// Relayed background-task results are user turns with origin.kind "task-notification"; scheduled fires and inbox messages are the user's own.
function isHostNotificationEntry(entry) {
  return (
    entry?.type === 'user' &&
    entry.origin?.kind === 'task-notification' &&
    !USER_AUTHORED_SUBKINDS.has(entry.origin.subkind)
  );
}

function readArgs(pid) {
  if (process.platform === 'linux') {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean);
  }
  return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 1000,
  })
    .trim()
    .split(/\s+/);
}

function readParentPid(pid) {
  if (process.platform === 'linux') {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  return Number(
    execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1000,
    }).trim(),
  );
}

// Exact argv is scanned to `--`; whitespace-split ps output stops at the first token that is neither an option nor the value of a known value-taking option.
function scanOptions(args, exact) {
  const options = [];
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    if (!exact && !args[i].startsWith('-')) break;
    options.push(args[i]);
    if (!exact && VALUE_OPTIONS.has(args[i])) i++;
  }
  return options;
}

// Option tokens of the Claude Code process that ran this hook (through `sh -c`); [] when unreadable.
function hostOptions() {
  try {
    let args = readArgs(process.ppid);
    if (SHELLS.has(path.basename(args[0] || '').replace(/^-/, ''))) {
      args = readArgs(readParentPid(process.ppid));
    }
    const first = /^(node|bun)(\.exe)?$/.test(path.basename(args[0] || ''))
      ? 2
      : 1;
    return scanOptions(args.slice(first), process.platform === 'linux');
  } catch {
    return [];
  }
}

// Claude Code keeps an inherited CLAUDE_CODE_ENTRYPOINT, so sdk-cli only counts when this process itself runs in print mode.
function isPrintMode() {
  const attended = process.env.CLAUDE_CODE_SESSION_ATTENDED;
  if (attended === '0') return true;
  if (attended === '1') return false;
  return hostOptions().some(
    (arg) => PRINT_FLAGS.has(arg) || arg.startsWith('--output-format'),
  );
}

function isHeadless() {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
  if (entrypoint === 'claude-code-github-action') return true;
  return entrypoint === 'sdk-cli' && isPrintMode();
}

// Host signals only: the task-notification prompt, CLAUDE_CODE_ENTRYPOINT with print mode, orchestrator env.
function getSkipReason(input, settings) {
  const orchestrated = isOrchestrated();
  if (orchestrated && !settings.captureOrchestrated) return 'orchestrated';
  if (
    !settings.captureSubagents &&
    typeof input?.prompt === 'string' &&
    input.prompt.trimStart().startsWith(TASK_NOTIFICATION_TAG)
  ) {
    return 'subagent';
  }
  if (!orchestrated && !settings.captureHeadless && isHeadless()) {
    return 'headless';
  }
  return null;
}

module.exports = { getSkipReason, isHostNotificationEntry, scanOptions };
