const {
  SupermemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
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
} = require('./lib/transcript-formatter');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { saveLastSession } = require('./lib/last-session');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const transcriptPath = input.transcript_path;
    const projectConfig = loadProjectConfig(cwd);

    debugLog(settings, 'Stop', { sessionId, transcriptPath });

    if (!transcriptPath || !sessionId) {
      debugLog(settings, 'Missing transcript path or session id');
      writeOutput({ continue: true });
      return;
    }

    let apiKey;
    try {
      apiKey = getApiKey(settings, cwd, projectConfig);
    } catch {
      writeOutput({ continue: true });
      return;
    }

    const signalConfig = getSignalConfig(cwd);
    const useSignalExtraction = signalConfig.enabled;

    debugLog(settings, 'Signal extraction', { enabled: useSignalExtraction });

    let capture;
    if (useSignalExtraction) {
      capture = formatSignalEntries(transcriptPath, sessionId, cwd);
      debugLog(settings, 'Signal extraction result', {
        hasContent: !!capture,
      });
    } else {
      capture = formatNewEntries(transcriptPath, sessionId, cwd);
    }

    if (!capture) {
      debugLog(settings, 'No new content to save');
      writeOutput({ continue: true });
      return;
    }

    const baseUrl = getBaseUrl(cwd, projectConfig);
    const client = new SupermemoryClient(apiKey, undefined, { baseUrl });
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    // The session document upserts by customId, and the backend APPENDS a
    // new revision only once the previous one finished processing — an
    // append sent mid-processing is silently dropped. If the doc is still
    // processing, skip this capture WITHOUT advancing the tracker: the
    // delta simply carries over into the next Stop.
    const docStatus = await client.getDocumentStatus(sessionId);
    if (docStatus && docStatus !== 'done' && docStatus !== 'failed') {
      debugLog(settings, 'Session doc still processing; deferring capture', {
        docStatus,
      });
      writeOutput({ continue: true });
      return;
    }

    const result = await client.addMemory(
      capture.content,
      containerTag,
      {
        type: 'session_turn',
        project: projectName,
        sm_project_id: getProjectIdentity(cwd),
        sm_scope: 'personal',
        sm_capture_mode: 'automatic',
        timestamp: new Date().toISOString(),
      },
      { customId: sessionId, entityContext: PERSONAL_ENTITY_CONTEXT },
    );

    // Advance the tracker only now that the capture is persisted — a failed
    // upload leaves the cursor untouched, so the delta retries next Stop
    // instead of being permanently lost.
    setLastCapturedUuid(sessionId, capture.cursor);

    if (result?.id) {
      saveLastSession({ id: result.id, containerTag });
    }

    debugLog(settings, 'Session turn saved', { length: capture.content.length });
    writeOutput({ continue: true });
  } catch (err) {
    const friendly = getUserFriendlyError(err);
    debugLog(settings, 'Error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
