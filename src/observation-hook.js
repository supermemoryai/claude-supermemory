const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadSettings, debugLog, shouldCaptureTool } = require('./lib/settings');
const { readStdin, outputSuccess } = require('./lib/stdin');

const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

function ensureTrackerDir() {
  if (!fs.existsSync(TRACKER_DIR)) {
    fs.mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function getActivityPath(sessionId) {
  return path.join(TRACKER_DIR, `${sessionId}.activity.json`);
}

function loadActivity(sessionId) {
  const filePath = getActivityPath(sessionId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {}
  return {
    tool_uses: 0,
    edits: 0,
    writes: 0,
    bash_commands: 0,
    tasks: 0,
    last_save_at_tool_count: 0,
    last_tool_at: null,
    session_id: sessionId,
  };
}

function saveActivity(sessionId, activity) {
  ensureTrackerDir();
  const filePath = getActivityPath(sessionId);
  fs.writeFileSync(filePath, JSON.stringify(activity, null, 2));
}

async function main() {
  const settings = loadSettings();

  try {
    const input = await readStdin();
    const sessionId = input.session_id;
    const toolName = input.tool_name;

    debugLog(settings, 'PostToolUse', { sessionId, toolName });

    if (!sessionId || !toolName) {
      outputSuccess();
      return;
    }

    // Only track tools that indicate meaningful work
    if (!shouldCaptureTool(toolName, settings)) {
      debugLog(settings, 'Skipping non-capture tool', { toolName });
      outputSuccess();
      return;
    }

    const activity = loadActivity(sessionId);
    activity.tool_uses += 1;
    activity.last_tool_at = new Date().toISOString();

    // Track by type
    switch (toolName) {
      case 'Edit':
        activity.edits += 1;
        break;
      case 'Write':
        activity.writes += 1;
        break;
      case 'Bash':
        activity.bash_commands += 1;
        break;
      case 'Task':
        activity.tasks += 1;
        break;
    }

    saveActivity(sessionId, activity);

    debugLog(settings, 'Activity tracked', {
      tool_uses: activity.tool_uses,
      since_last_save: activity.tool_uses - activity.last_save_at_tool_count,
    });

    outputSuccess();
  } catch (err) {
    debugLog(settings, 'Error', { error: err.message });
    outputSuccess();
  }
}

main().catch((err) => {
  console.error(`Supermemory fatal: ${err.message}`);
  process.exit(1);
});
