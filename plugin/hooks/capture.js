const { addMemory, AGENT_ENTITY_CONTEXT, getDocumentById } = require('./lib/api');
const { isAlreadyStored, trimForAppend } = require('./lib/capture-dedup');
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

function isCaptureTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

async function readStoredSessionContent(baseUrl, apiKey, sessionId) {
  try {
    const doc = await getDocumentById(baseUrl, apiKey, sessionId, {
      timeoutMs: CAPTURE_TIMEOUT_MS,
    });
    return typeof doc?.content === 'string' ? doc.content : '';
  } catch (err) {
    if (err?.status === 404) return '';
    throw err;
  }
}

// Stop allows 30s; this write outlives the 3s default without slowing SessionStart.
async function main() {
  const settings = loadSettings();
  let sessionId;
  let delta;
  let baseUrl;
  let apiKey;
  let captured = 0;

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

    try {
      apiKey = getApiKey(cwd, projectConfig);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    delta = getSignalConfig(cwd).enabled
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

    captured = readState(sessionId, 'capture')?.count || 0;
    if (!delta) {
      writeState(sessionId, 'capture', {
        status: 'no_content',
        count: captured,
      });
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    baseUrl = getBaseUrl(cwd, projectConfig);
    const containerTag = getContainerTag(cwd);

    writeState(sessionId, 'capture', { status: 'saving', count: captured });

    const pending = redactSecrets(delta.formatted);
    const stored = await readStoredSessionContent(baseUrl, apiKey, sessionId);
    if (isAlreadyStored(stored, pending)) {
      setLastCapturedUuid(sessionId, delta.lastUuid, delta.pendingReplies);
      writeState(sessionId, 'capture', { status: 'saved', count: captured + 1 });
      clearCaptureNotice();
      debugLog(settings, 'Capture skipped — server already has this delta', {
        sessionId,
      });
      writeOutput({ continue: true });
      return;
    }
    const content = trimForAppend(stored, pending);
    if (!content.trim()) {
      writeState(sessionId, 'capture', { status: 'no_content', count: captured });
      writeOutput({ continue: true });
      return;
    }

    const result = await addMemory(
      baseUrl,
      apiKey,
      content,
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
    if (isCaptureTimeout(err) && sessionId && delta?.formatted && baseUrl && apiKey) {
      try {
        const stored = await readStoredSessionContent(baseUrl, apiKey, sessionId);
        const pending = redactSecrets(delta.formatted);
        if (isAlreadyStored(stored, pending)) {
          setLastCapturedUuid(sessionId, delta.lastUuid, delta.pendingReplies);
          writeState(sessionId, 'capture', {
            status: 'saved',
            count: captured + 1,
          });
          clearCaptureNotice();
          debugLog(settings, 'Capture reconciled after timeout — content already stored', {
            sessionId,
          });
          writeOutput({ continue: true });
          return;
        }
      } catch (reconcileErr) {
        debugLog(settings, 'Capture reconcile after timeout failed', {
          error: reconcileErr.message,
        });
      }
    }

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
