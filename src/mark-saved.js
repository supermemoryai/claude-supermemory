const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TRACKER_DIR = path.join(os.homedir(), '.supermemory-claude', 'trackers');

function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.log(JSON.stringify({ error: 'Usage: mark-saved.cjs <session_id>' }));
    process.exit(1);
  }

  const filePath = path.join(TRACKER_DIR, `${sessionId}.activity.json`);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(JSON.stringify({ success: true, message: 'No activity to mark' }));
      return;
    }

    const activity = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    activity.last_save_at_tool_count = activity.tool_uses;
    activity.last_saved_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(activity, null, 2));

    console.log(JSON.stringify({ success: true, tool_uses: activity.tool_uses }));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
