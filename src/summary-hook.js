const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey, debugLog } = require('./lib/settings');
const { readStdin, writeOutput } = require('./lib/stdin');
const { formatNewEntries } = require('./lib/transcript-formatter');

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const sessionId = input.session_id;

    debugLog(settings, 'Stop hook disabled — using save-memory skill for curated saves', { sessionId });

    // The Stop hook previously dumped full session transcripts (80KB+) into
    // Supermemory, creating noisy low-quality memories. This has been replaced
    // by the save-memory skill, which lets Claude extract structured memories
    // with user approval during the session.
    writeOutput({ continue: true });
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    writeOutput({ continue: true });
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
