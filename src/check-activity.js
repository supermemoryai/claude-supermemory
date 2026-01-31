const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.log(JSON.stringify({ error: 'Usage: check-activity.cjs <session_id>' }));
    process.exit(1);
  }

  const filePath = path.join(TRACKER_DIR, `${sessionId}.activity.json`);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(JSON.stringify({
        tool_uses: 0,
        since_last_save: 0,
        should_prompt: false,
      }));
      return;
    }

    const activity = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const sinceLast = activity.tool_uses - (activity.last_save_at_tool_count || 0);

    // Suggest prompting after 5+ significant tool uses since last save
    const shouldPrompt = sinceLast >= 5;

    console.log(JSON.stringify({
      ...activity,
      since_last_save: sinceLast,
      should_prompt: shouldPrompt,
    }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
