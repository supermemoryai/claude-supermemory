const {
  LocalMemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/local-memory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const {
  loadSettings,
  debugLog,
  getSignalConfig,
} = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const {
  formatNewEntries,
  formatSignalEntries,
} = require('./lib/transcript-formatter');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const transcriptPath = input.transcript_path;

    debugLog(settings, 'Stop', { sessionId, transcriptPath });

    if (!transcriptPath || !sessionId) {
      debugLog(settings, 'Missing transcript path or session id');
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
      writeOutput({ continue: true });
      return;
    }

    const client = new LocalMemoryClient();
    const containerTag = getContainerTag(cwd);
    const projectName = getProjectName(cwd);

    await client.addMemory(
      formatted,
      containerTag,
      {
        type: 'session_turn',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
    );

    debugLog(settings, 'Session turn saved', { length: formatted.length });
    writeOutput({ continue: true });
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    console.error(`Supermemory-local: ${err.message}`);
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory-local fatal: ${err.message}`);
  process.exit(1);
});
