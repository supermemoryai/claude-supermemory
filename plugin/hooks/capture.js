const { addMemory, AGENT_ENTITY_CONTEXT } = require('./lib/api');
const { redactSecrets } = require('./lib/redact');
const {
  getContainerTag,
  getProjectIdentity,
  getProjectName,
} = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const {
  loadSettings,
  getAuthToken,
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
      apiKey = await getAuthToken(cwd, projectConfig);
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
    const containerTag = getContainerTag(cwd);

    writeState(sessionId, 'capture', { status: 'saving', count: captured });

    const result = await addMemory(
      baseUrl,
      apiKey,
      redactSecrets(delta.formatted),
      containerTag,
      {
        type: 'session_turn',
        project: getProjectName(cwd),
        sm_project_id: getProjectIdentity(cwd),
        sm_scope: 'personal',
        sm_capture_mode: 'automatic',
        timestamp: new Date().toISOString(),
      },
      {
        customId: sessionId,
        entityContext: AGENT_ENTITY_CONTEXT,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      },
    );

    setLastCapturedUuid(sessionId, delta.lastUuid, delta.pendingReplies);
    writeState(sessionId, 'capture', { status: 'saved', count: captured + 1 });
    clearCaptureNotice();

    if (result?.id) {
      try {
        saveLastSession({ id: result.id, containerTag });
      } catch {}
    }

    debugLog(settings, 'Session turn saved', { length: delta.formatted.length });
    writeOutput({ continue: true });
  } catch (err) {
    const status = err?.status ?? err?.statusCode;
    const friendly = redactSecrets(
      getUserFriendlyError(
        typeof status === 'number'
          ? { status, message: `Supermemory API returned HTTP ${status}.` }
          : err,
      ),
    );
    debugLog(settings, 'Capture error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeCaptureNotice(friendly);
    writeState(sessionId, 'capture', { status: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${redactSecrets(err.message)}`);
  process.exit(1);
});
