const { addMemory, AGENT_ENTITY_CONTEXT } = require('./lib/api');
const {
  getContainerTag,
  getProjectIdentity,
  getProjectName,
} = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getApiKey,
  getBaseUrl,
  debugLog,
  getSignalConfig,
} = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const {
  formatNewEntries,
  formatSignalEntries,
  setLastCapturedUuid,
} = require('./lib/transcript');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { saveLastSession } = require('./lib/last-session');
const { readState, writeState } = require('./lib/statusline-state');

async function main() {
  const settings = loadSettings();
  let sessionId;

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    sessionId = input.session_id;
    const transcriptPath = input.transcript_path;
    const projectConfig = loadProjectConfig(cwd);

    if (!transcriptPath || !sessionId) {
      writeOutput({ continue: true });
      return;
    }

    let apiKey;
    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    const delta = getSignalConfig(cwd).enabled
      ? formatSignalEntries(transcriptPath, sessionId, cwd)
      : formatNewEntries(transcriptPath, sessionId, cwd);

    if (!delta) {
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    const baseUrl = getBaseUrl(cwd, projectConfig, apiKey);
    const containerTag = getContainerTag(cwd);

    const captured = readState(sessionId).capture?.count || 0;
    writeState(sessionId, 'capture', { status: 'saving', count: captured });

    const result = await addMemory(
      baseUrl,
      apiKey,
      delta.formatted,
      containerTag,
      {
        type: 'session_turn',
        project: getProjectName(cwd),
        sm_project_id: getProjectIdentity(cwd),
        sm_scope: 'personal',
        sm_capture_mode: 'automatic',
        timestamp: new Date().toISOString(),
      },
      { customId: sessionId, entityContext: AGENT_ENTITY_CONTEXT },
    );

    setLastCapturedUuid(sessionId, delta.lastUuid);
    writeState(sessionId, 'capture', { status: 'saved', count: captured + 1 });

    if (result?.id) {
      try {
        saveLastSession({ id: result.id, containerTag });
      } catch {}
    }

    debugLog(settings, 'Session turn saved', {
      length: delta.formatted.length,
    });
    writeOutput({ continue: true });
  } catch (err) {
    const friendly = getUserFriendlyError(err);
    debugLog(settings, 'Capture error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeState(sessionId, 'capture', { status: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
