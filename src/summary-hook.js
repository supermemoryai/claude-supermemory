const {
  SupermemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
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
} = require('./lib/transcript-formatter');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { saveLastSession } = require('./lib/last-session');
const { writeState } = require('./lib/statusline-state');

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

    let formatted;
    if (useSignalExtraction) {
      formatted = formatSignalEntries(transcriptPath, sessionId, cwd);
      debugLog(settings, 'Signal extraction result', {
        hasContent: !!formatted,
      });
    } else {
      formatted = formatNewEntries(transcriptPath, sessionId, cwd);
    }

    if (!formatted) {
      debugLog(settings, 'No new content to save');
      writeState({ ingesting: false, lastIngestStatus: 'skipped' });
      writeOutput({ continue: true });
      return;
    }

    const baseUrl = getBaseUrl(cwd, projectConfig);
    const client = new SupermemoryClient(apiKey, undefined, { baseUrl });
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    // Count turns/signals as a proxy for "things learnt"
    const turnCount = (formatted.match(/<\|start\|>/g) || []).length;
    const learntCount = Math.max(1, Math.ceil(turnCount / 2));

    writeState({ ingesting: true, learntCount });

    const result = await client.addMemory(
      formatted,
      containerTag,
      {
        type: 'session_turn',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
      { customId: sessionId, entityContext: PERSONAL_ENTITY_CONTEXT },
    );

    if (result?.id) {
      saveLastSession({ id: result.id, containerTag });
    }

    writeState({ ingesting: false, lastIngestStatus: 'saved', lastIngestAt: Date.now(), learntCount });
    debugLog(settings, 'Session turn saved', { length: formatted.length });
    writeOutput({ continue: true });
  } catch (err) {
    const friendly = getUserFriendlyError(err);
    debugLog(settings, 'Error', { error: friendly });
    console.error(`Supermemory: ${friendly}`);
    writeState({ ingesting: false, lastIngestStatus: 'error' });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
