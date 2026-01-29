# Claude-Supermemory

<img width="1386" height="258" alt="Screenshot 2026-01-28 at 11 34 13 PM" src="https://github.com/user-attachments/assets/a692791a-a054-495a-ab53-45f1071ff26f" />

A Claude Code plugin that gives your AI persistent memory across sessions using [Supermemory](https://supermemory.ai).
Your agent remembers what you worked on - across sessions, across projects.


## Features

- **Context Injection**: On session start, relevant memories are automatically injected into Claude's context
- **Automatic Capture**: Tool usage (Edit, Write, Bash, Task) is captured as compressed observations
- **Privacy Tags**: Use `<private>sensitive info</private>` to prevent content from being stored

## Installation

```bash
# Add the plugin marketplace
/plugin marketplace add supermemoryai/claude-supermemory

# Or from local directory
/plugin marketplace add /path/to/claude-supermemory

# Install the plugin
/plugin install claude-supermemory

# Set your API key
export SUPERMEMORY_CC_API_KEY="sm_..."
```

Get your API key at [console.supermemory.ai](https://console.supermemory.ai).

## How It Works

### On Session Start

The plugin fetches relevant memories from Supermemory and injects them into Claude's context:

```
<supermemory-context project="myproject">

## User Preferences
- Prefers TypeScript over JavaScript
- Uses Bun as package manager

## Project Knowledge
- Authentication uses JWT tokens
- API routes are in src/routes/

</supermemory-context>
```

### During Session

Tool usage is automatically captured:

| Tool  | What's Captured                                     |
| ----- | --------------------------------------------------- |
| Edit  | `Edited src/auth.ts: "old code..." → "new code..."` |
| Write | `Created src/new-file.ts (500 chars)`               |
| Bash  | `Ran: npm test (SUCCESS/FAILED)`                    |
| Task  | `Spawned agent: explore codebase`                   |

## Commands

### /claude-supermemory:logout

Log out from Supermemory and clear saved credentials. Use this to re-authenticate or switch accounts.

```
/claude-supermemory:logout
```

## Configuration

### Environment Variables

```bash
# Required
SUPERMEMORY_CC_API_KEY=sm_...

# Optional
SUPERMEMORY_SKIP_TOOLS=Read,Glob,Grep    # Tools to not capture
SUPERMEMORY_DEBUG=true                    # Enable debug logging
```

### Settings File

Create `~/.supermemory-claude/settings.json`:

```json
{
  "skipTools": ["Read", "Glob", "Grep", "TodoWrite"],
  "captureTools": ["Edit", "Write", "Bash", "Task"],
  "maxContextMemories": 10,
  "maxProjectMemories": 20,
  "debug": false
}
```

## License

MIT
