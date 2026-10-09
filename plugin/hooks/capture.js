const { addMemory, AGENT_SUPPORTING_CONTEXT } = require('./lib/api');
const {
  getNamespace,
  getProjectIdentity,
  getProjectName,
} = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getApiKey,
  getBaseUrl,
  getApiVersion,
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
const {
  clearCaptureNotice,
  readState,
  writeCaptureNotice,
  writeState,
} = require('./lib/session-state');

const CAPTURE_TIMEOUT_MS = 25000;

// Stop allows 30s; this write outlives the 3s default without slowing SessionStart.
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
      ? formatSignalEntries(
          transcriptPath,
          sessionId,
          cwd,
          input.last_assistant_message,
        )
      : formatNewEntries(
          transcriptPath,
          sessionId,
          cwd,
          input.last_assistant_message,
        );

    const captured = readState(sessionId, 'capture')?.count || 0;
    if (!delta) {
      writeState(sessionId, 'capture', {
        status: 'no_content',
        count: captured,
      });
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    const baseUrl = getBaseUrl(cwd, projectConfig);
    const namespace = getNamespace(cwd);

    writeState(sessionId, 'capture', { status: 'saving', count: captured });

    const result = await addMemory(
      baseUrl,
      apiKey,
      delta.formatted,
      namespace,
      {
        type: 'session_turn',
        project: getProjectName(cwd),
        sm_project_id: getProjectIdentity(cwd),
        sm_scope: 'personal',
        sm_capture_mode: 'automatic',
        timestamp: new Date().toISOString(),
      },
      {
        id: sessionId,
        supportingContext: AGENT_SUPPORTING_CONTEXT,
        apiVersion: getApiVersion(cwd, projectConfig),
        timeoutMs: CAPTURE_TIMEOUT_MS,
      },
    );

    setLastCapturedUuid(sessionId, delta.lastUuid, delta.pendingReplies);
    writeState(sessionId, 'capture', { status: 'saved', count: captured + 1 });
    clearCaptureNotice();

    if (result?.id) {
      try {
        saveLastSession({ id: result.id, containerTag: namespace });
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
    writeCaptureNotice(friendly);
    writeState(sessionId, 'capture', { status: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
