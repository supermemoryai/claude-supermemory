const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getProfiles } = require('./lib/api');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const {
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
} = require('./lib/context');
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
const {
  pruneState,
  resolveStatuslineDataDir,
  writeState,
} = require('./lib/statusline-state');

const STATUSLINE_LINK = path.join(
  os.homedir(),
  '.supermemory-claude',
  'statusline-current',
);
const STATUSLINE_TIP_FILE = path.join(
  os.homedir(),
  '.supermemory-claude',
  'statusline-tip-shown',
);
const STATUSLINE_INSTALLED_FILE = path.join(
  os.homedir(),
  '.supermemory-claude',
  'statusline-installed',
);
const STATUSLINE_ENTRY = {
  type: 'command',
  command: 'node ~/.supermemory-claude/statusline-current',
  refreshInterval: 1,
};

// The statusline setting needs one path that survives plugin updates; a
// symlink re-pointed each session is that path — no code is ever copied.
function refreshStatuslineLink() {
  const target = path.join(__dirname, '..', 'statusline.js');
  try {
    fs.mkdirSync(path.dirname(STATUSLINE_LINK), { recursive: true });
    try {
      if (fs.readlinkSync(STATUSLINE_LINK) === target) return;
      fs.unlinkSync(STATUSLINE_LINK);
    } catch {}
    fs.symlinkSync(target, STATUSLINE_LINK);
  } catch {}
}

// Installs the statusline into ~/.claude/settings.json on first run. The
// sentinel file records that we installed once, so a user who deletes the
// entry is never fought; a foreign statusLine is never overwritten.
function installStatusline() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return `${MARK} statusline not installed — ~/.claude/settings.json is unreadable: ${err.message}`;
      }
    }
    if (
      JSON.stringify(settings.statusLine || '').includes('statusline-current')
    ) {
      return null;
    }
    if (settings.statusLine) {
      if (fs.existsSync(STATUSLINE_TIP_FILE)) return null;
      fs.mkdirSync(path.dirname(STATUSLINE_TIP_FILE), { recursive: true });
      fs.writeFileSync(STATUSLINE_TIP_FILE, new Date().toISOString());
      return `${MARK} Supermemory status line available — you already have a "statusLine" in ~/.claude/settings.json; replace it with ${JSON.stringify(STATUSLINE_ENTRY)} to switch.`;
    }
    if (fs.existsSync(STATUSLINE_INSTALLED_FILE)) return null;
    settings.statusLine = STATUSLINE_ENTRY;
    const tmp = `${settingsPath}.supermemory-tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
    fs.renameSync(tmp, settingsPath);
    fs.mkdirSync(path.dirname(STATUSLINE_INSTALLED_FILE), { recursive: true });
    fs.writeFileSync(STATUSLINE_INSTALLED_FILE, new Date().toISOString());
    return `${MARK} statusline installed — it appears the next time Claude Code starts (delete "statusLine" from ~/.claude/settings.json to turn it off).`;
  } catch (err) {
    return `${MARK} statusline install failed: ${err.message}`;
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
    return `${MARK} is the supermemory mark — whenever you see it (statusline, notices, Claude's answers), that information came from supermemory.`;
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
      hours < 48
        ? `${Math.round(hours)}h ago`
        : `${Math.round(hours / 24)}d ago`;
    return `welcome back — last session here ${ago}`;
  } catch {
    return null;
  }
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

    refreshStatuslineLink();
    pruneState({ dataDir: resolveStatuslineDataDir() });
    writeState(sessionId, 'context', {
      status: 'loading',
      memoryItemsLoaded: 0,
    });

    const projectConfig = loadProjectConfig(cwd);
    const projectName = getProjectName(cwd);
    const containerTag = getContainerTag(cwd);
    const containerTags = getRecallContainerTags(containerTag, settings);

    debugLog(settings, 'SessionStart', {
      cwd,
      projectName,
      containerTag,
      containerTags,
    });

    let apiKey;
    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      try {
        apiKey = await startAuthFlow();
      } catch (authErr) {
        writeState(sessionId, 'context', {
          status: 'error',
          memoryItemsLoaded: 0,
        });
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

    const baseUrl = getBaseUrl(cwd, projectConfig, apiKey);

    let profileResult = null;
    let apiError = null;
    try {
      const responses = await getProfiles(
        baseUrl,
        apiKey,
        containerTags,
        undefined,
      );
      profileResult = mergeProfileResults(responses, settings.maxMemories);
    } catch (err) {
      // Fail open, but never silently: a network failure must not be dressed
      // up as "this project has no memories". Only 404 means genuinely empty.
      if (err?.status !== 404) apiError = getUserFriendlyError(err);
      debugLog(settings, 'Profile fetch failed', { error: err.message });
    }

    const { text: context, newFacts } = formatSessionContext(profileResult, {
      maxProfileItems: settings.maxProfileItems,
      maxTokens: settings.maxRecallTokens,
      containerTag,
      projectName,
    });
    const loaded = newFacts.length;

    writeState(sessionId, 'context', {
      status: apiError ? 'error' : 'ready',
      memoryItemsLoaded: loaded,
    });

    const memoryNotice =
      loaded > 0
        ? `${BRAND} ${gray('·')} ${loaded} ${loaded === 1 ? 'memory' : 'memories'} loaded for ${bold(projectName)}`
        : null;

    output(
      (apiError
        ? `<supermemory-status>\n${apiError}\n</supermemory-status>\n`
        : '') +
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
        installStatusline(),
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
