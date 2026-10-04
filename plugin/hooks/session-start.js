const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getProfile } = require('./lib/api');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
} = require('./lib/settings');
const { BRAND, MARK, bold, gray } = require('./lib/colors');
const { readStdin, writeOutput } = require('./lib/stdin');
const { startAuthFlow, AUTH_BASE_URL } = require('./lib/auth');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { LAST_SESSION_FILE } = require('./lib/last-session');
const { pruneState, writeState } = require('./lib/session-state');

const STATUSLINE_INSTALLED_FILE = path.join(
  os.homedir(),
  '.supermemory-claude',
  'statusline-installed',
);
// Only the old install marker plus the exact entry it wrote proves ownership.
function removeLegacyStatusline() {
  if (!fs.existsSync(STATUSLINE_INSTALLED_FILE)) return null;
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const stat = fs.lstatSync(settingsPath);
    if (!stat.isFile()) return null;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const entry = settings?.statusLine;
    if (
      entry &&
      !Array.isArray(entry) &&
      Object.keys(entry).length === 3 &&
      entry.type === 'command' &&
      entry.command === 'node ~/.supermemory-claude/statusline-current' &&
      entry.refreshInterval === 1
    ) {
      delete settings.statusLine;
      const tmp = path.join(
        path.dirname(settingsPath),
        `.settings.supermemory-${crypto.randomUUID()}.tmp`,
      );
      try {
        fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, {
          flag: 'wx',
          mode: stat.mode & 0o777,
        });
        fs.renameSync(tmp, settingsPath);
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
    fs.unlinkSync(STATUSLINE_INSTALLED_FILE);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return `${MARK} could not finish removing the old Supermemory status line: ${err.message}`;
  }
}

const MARK_TIP_FILE = path.join(
  os.homedir(),
  '.supermemory-claude',
  'mark-tip-shown',
);

function markTip() {
  try {
    if (fs.existsSync(MARK_TIP_FILE)) return null;
    fs.mkdirSync(path.dirname(MARK_TIP_FILE), { recursive: true });
    fs.writeFileSync(MARK_TIP_FILE, new Date().toISOString());
    return `${MARK} is the supermemory mark — whenever you see it (notices or Claude's answers), that information came from supermemory.`;
  } catch {
    return null;
  }
}

function welcomeBackNotice(containerTag) {
  try {
    const last = JSON.parse(fs.readFileSync(LAST_SESSION_FILE, 'utf-8'));
    if (!last.savedAt || last.containerTag !== containerTag) return null;
    const hours = (Date.now() - new Date(last.savedAt).getTime()) / 3600000;
    if (hours < 6) return null;
    const ago =
      hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
    return `welcome back — last session here ${ago}`;
  } catch {
    return null;
  }
}

function formatContext(profileResult, maxItems, containerTag, projectName) {
  const statics = (profileResult?.profile?.static || []).slice(0, maxItems);
  const dynamics = (profileResult?.profile?.dynamic || []).slice(0, maxItems);
  if (statics.length === 0 && dynamics.length === 0) return null;

  const sections = [];
  if (statics.length > 0) {
    sections.push(
      `## User Profile (Persistent)\n${statics.map((f) => `- ◪ ${f}`).join('\n')}`,
    );
  }
  if (dynamics.length > 0) {
    sections.push(
      `## Recent Context\n${dynamics.map((f) => `- ◪ ${f}`).join('\n')}`,
    );
  }

  return `<supermemory-context>
Recalled memory for this project (${projectName}). Every line marked ◪ comes from supermemory — when citing one, keep the mark and phrase it naturally (e.g. "◪ last week you told me about X"). If you name the source, say "from supermemory" — never "from memory".
This project's memory container: ${containerTag}

${sections.join('\n\n')}
</supermemory-context>`;
}

function output(additionalContext, systemMessageParts) {
  const systemMessage = systemMessageParts.filter(Boolean).join('\n');
  writeOutput({
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  });
}

async function main() {
  const settings = loadSettings();
  let sessionId;

  try {
    const input = await readStdin();
    sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    const statuslineCleanupNotice = removeLegacyStatusline();
    pruneState();
    writeState(sessionId, 'context', { status: 'loading', memoryItemsLoaded: 0 });

    const projectConfig = loadProjectConfig(cwd);
    const projectName = getProjectName(cwd);
    const containerTag = getContainerTag(cwd);

    debugLog(settings, 'SessionStart', { cwd, projectName, containerTag });

    let apiKey;
    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      try {
        apiKey = await startAuthFlow();
      } catch (authErr) {
        writeState(sessionId, 'context', { status: 'error', memoryItemsLoaded: 0 });
        output(
          `<supermemory-status>
${authErr.message === 'AUTH_TIMEOUT' ? 'Authentication timed out. Please complete login in the browser window.' : 'Authentication failed.'}
If the browser did not open, visit: ${AUTH_BASE_URL}
Or set the SUPERMEMORY_CC_API_KEY environment variable.
</supermemory-status>`,
          [],
        );
        return;
      }
    }

    const baseUrl = getBaseUrl(cwd, projectConfig);

    let profileResult = null;
    let apiError = null;
    try {
      profileResult = await getProfile(baseUrl, apiKey, containerTag, projectName);
    } catch (err) {
      // Fail open, but never silently: a network failure must not be dressed
      // up as "this project has no memories". Only 404 means genuinely empty.
      if (err?.status !== 404) apiError = getUserFriendlyError(err);
      debugLog(settings, 'Profile fetch failed', { error: err.message });
    }

    const context = formatContext(
      profileResult,
      settings.maxProfileItems,
      containerTag,
      projectName,
    );
    const loaded =
      Math.min(profileResult?.profile?.static?.length || 0, settings.maxProfileItems) +
      Math.min(profileResult?.profile?.dynamic?.length || 0, settings.maxProfileItems);

    writeState(sessionId, 'context', {
      status: apiError ? 'error' : 'ready',
      memoryItemsLoaded: loaded,
    });

    const memoryNotice =
      loaded > 0
        ? `${BRAND} ${gray('·')} ${loaded} ${loaded === 1 ? 'memory' : 'memories'} loaded for ${bold(projectName)}`
        : null;

    output(
      (apiError ? `<supermemory-status>\n${apiError}\n</supermemory-status>\n` : '') +
        (context ||
          (apiError
            ? `<supermemory-context>
Memory could not be loaded this session — do not assume this project has no memories.
</supermemory-context>`
            : `<supermemory-context>
No previous memories found for this project (container: ${containerTag}).
Memories will be saved as you work.
</supermemory-context>`)),
      [
        [memoryNotice, welcomeBackNotice(containerTag)]
          .filter(Boolean)
          .join(gray(' · ')) || null,
        markTip(),
        statuslineCleanupNotice,
      ],
    );
  } catch (err) {
    const friendly = getUserFriendlyError(err);
    console.error(`Supermemory: ${friendly}`);
    writeState(sessionId, 'context', { status: 'error', memoryItemsLoaded: 0 });
    output(
      `<supermemory-status>
Failed to load memories: ${friendly}
Session will continue without memory context.
</supermemory-status>`,
      [],
    );
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
