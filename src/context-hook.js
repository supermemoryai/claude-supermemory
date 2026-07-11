const { SupermemoryClient } = require('./lib/supermemory-client');
const {
  getContainerTag,
  getRepoContainerTag,
  getProjectName,
} = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { startAuthFlow, AUTH_BASE_URL } = require('./lib/auth');
const { formatContext, combineContexts } = require('./lib/format-context');
const { getUserFriendlyError, isBenignError } = require('./lib/error-helpers');
const { checkForUpdate, formatUpdateNotice } = require('./lib/version-check');
const {
  buildContainerRoutingPrompt,
  saveContainerRouting,
} = require('./lib/container-routing');

const PLUGIN_VERSION = '0.0.5';

function combineOutputParts(parts) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const projectName = getProjectName(cwd);
    const updateCheck = checkForUpdate(PLUGIN_VERSION).then((info) =>
      info ? formatUpdateNotice(info) : null,
    );

    debugLog(settings, 'SessionStart', { cwd, projectName });

    let apiKey;
    try {
      apiKey = getApiKey(settings);
    } catch {
      try {
        debugLog(settings, 'No API key found, starting browser auth flow');
        apiKey = await startAuthFlow();
        debugLog(settings, 'Auth flow completed successfully');
      } catch (authErr) {
        const isTimeout = authErr.message === 'AUTH_TIMEOUT';
        writeOutput({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: combineOutputParts([
              `<supermemory-status>
${isTimeout ? 'Authentication timed out. Please complete login in the browser window.' : 'Authentication failed.'}
If the browser did not open, visit: ${AUTH_BASE_URL}
Or set SUPERMEMORY_CC_API_KEY environment variable manually.
</supermemory-status>`,
              await updateCheck,
            ]),
          },
        });
        return;
      }
    }

    const client = new SupermemoryClient(apiKey);
    const personalTag = getContainerTag(cwd);
    const repoTag = getRepoContainerTag(cwd);

    debugLog(settings, 'Fetching contexts', { personalTag, repoTag });

    const apiErrors = [];

    const handleProfileError = (label) => (err) => {
      if (isBenignError(err)) {
        debugLog(settings, `Benign error fetching ${label} context`, {
          status: err.status,
          message: err.message,
        });
        return null;
      }
      const friendly = getUserFriendlyError(err);
      debugLog(settings, `Error fetching ${label} context`, {
        status: err.status,
        message: friendly,
      });
      apiErrors.push(friendly);
      return null;
    };

    const [personalResult, repoResult, containerTags] = await Promise.all([
      client
        .getProfile(personalTag, projectName)
        .catch(handleProfileError('personal')),
      client.getProfile(repoTag, projectName).catch(handleProfileError('repo')),
      client.listContainerTags().catch(handleProfileError('container tags')),
    ]);

    const availableContainerTags = containerTags || [];
    saveContainerRouting(sessionId, availableContainerTags, personalTag);
    const routingPrompt = buildContainerRoutingPrompt(
      availableContainerTags,
      personalTag,
    );

    const personalContext = formatContext(
      personalResult,
      true,
      false,
      settings.maxProfileItems,
      false,
    );

    const repoContext = formatContext(
      repoResult,
      true,
      false,
      settings.maxProfileItems,
      false,
    );

    const additionalContext = combineContexts([
      { label: '### Personal Memories', content: personalContext },
      {
        label: '### Project Knowledge (Shared across team)',
        content: repoContext,
      },
    ]);

    const errorNotice =
      apiErrors.length > 0
        ? `<supermemory-status>\n${[...new Set(apiErrors)].join('\n')}\n</supermemory-status>\n`
        : '';

    if (!additionalContext) {
      const updateNotice = await updateCheck;
      writeOutput({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: combineOutputParts([
            apiErrors.length > 0
              ? errorNotice
              : `<supermemory-context>
No previous memories found for this project.
Memories will be saved as you work.
</supermemory-context>`,
            routingPrompt,
            updateNotice,
          ]),
        },
      });
      return;
    }

    debugLog(settings, 'Context generated', {
      length: additionalContext.length,
      hasPersonal: !!personalContext,
      hasRepo: !!repoContext,
      containerTags: availableContainerTags.length,
    });

    const updateNotice = await updateCheck;
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: combineOutputParts([
          errorNotice + additionalContext,
          routingPrompt,
          updateNotice,
        ]),
      },
    });
  } catch (err) {
    const friendly = getUserFriendlyError(err);
    debugLog(settings, 'Error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeOutput({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `<supermemory-status>
Failed to load memories: ${friendly}
Session will continue without memory context.
</supermemory-status>`,
      },
    });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
