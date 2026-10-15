const { addSession, AGENT_ENTITY_CONTEXT } = require('./lib/api');
const { readRawDelta } = require('./lib/session');
const { redactSecrets } = require('./lib/redact');
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
} = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { getUserFriendlyError } = require('./lib/error-helpers');
const {
  clearCaptureNotice,
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

    const session = readRawDelta(transcriptPath, sessionId);
    if (!session) {
      writeOutput({ continue: true });
      return;
    }

    await addSession(
      getBaseUrl(cwd, projectConfig),
      apiKey,
      getContainerTag(cwd),
      session.raw,
      {
        sessionId,
        generation: session.generation,
        offset: session.offset,
        supportingContext: AGENT_ENTITY_CONTEXT,
        metadata: {
          type: 'session_turn',
          project: getProjectName(cwd),
          sm_project_id: getProjectIdentity(cwd),
          sm_scope: 'personal',
          sm_capture_mode: 'automatic',
          timestamp: new Date().toISOString(),
        },
        timeoutMs: CAPTURE_TIMEOUT_MS,
      },
    );

    session.commit();
    clearCaptureNotice();
    debugLog(settings, 'Session sent', {
      bytes: session.raw.length,
      generation: session.generation,
    });
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
    if (sessionId) writeState(sessionId, 'capture', { status: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${redactSecrets(err.message)}`);
  process.exit(1);
});
