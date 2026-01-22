# Claude-Supermemory

A Claude Code plugin that gives your AI persistent memory across sessions using [Supermemory](https://supermemory.ai).

Your agent remembers what you worked on - across sessions, across projects.

## Features

- **Context Injection**: On session start, relevant memories are automatically injected into Claude's context
- **Automatic Capture**: Tool usage (Edit, Write, Bash, Task) is captured as compressed observations
- **Privacy Tags**: Use `<private>sensitive info</private>` to prevent content from being stored
- **Project Scoping**: Memories are scoped by project (via git root or directory)
- **MCP Tools**: Optionally enable explicit memory/recall tools via Supermemory MCP

## Installation

### Quick Install

```bash
# Add the plugin marketplace
/plugin marketplace add supermemoryai/claude-supermemory
# at different dir at local
/plugin marketplace add /Users/prasanna/Documents/supermemoryai/claude-supermemory

# Install the plugin
/plugin install claude-supermemory@supermemory-plugins

# Set your API key
export SUPERMEMORY_API_KEY="sm_..."
```

Get your API key at [console.supermemory.ai](https://console.supermemory.ai).

### Manual Installation

1. Clone this repository
2. Add to your Claude Code settings (`~/.claude/settings.json`):
   ```json
   {
     "plugins": ["file:///path/to/claude-supermemory/plugin"]
   }
   ```
3. Set your API key: `export SUPERMEMORY_API_KEY="sm_..."`

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

### Privacy

Wrap sensitive content in `<private>` tags:

```
The API key is <private>sk-abc123</private>
```

This content will never be stored in Supermemory.

## Configuration

### Environment Variables

```bash
# Required
SUPERMEMORY_API_KEY=sm_...

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

## MCP Integration (Optional)

For explicit memory/recall tools, add Supermemory MCP to your Claude Code config:

```json
{
  "mcpServers": {
    "supermemory": {
      "url": "https://mcp.supermemory.ai/mcp",
      "headers": {
        "Authorization": "Bearer ${SUPERMEMORY_API_KEY}"
      }
    }
  }
}
```

This adds:

- `memory` tool - Save/forget memories explicitly
- `recall` tool - Search memories

## Project Scoping

Memories are scoped by project using a container tag:

1. If in a git repository: uses git root path hash
2. Otherwise: uses current working directory hash

This means:

- `/myproject/src` and `/myproject/backend` share memories (same git root)
- Different projects have separate memory spaces

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE CODE                                 │
│                                                                  │
│   SessionStart ──► Fetch & inject context                       │
│   UserPromptSubmit ──► Save user prompt                         │
│   PostToolUse ──► Save compressed observation                   │
│   Stop ──► Save session marker                                  │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SUPERMEMORY API                                │
│                 api.supermemory.ai                              │
│                                                                  │
│   POST /v3/memories    ──► Add memories                         │
│   POST /v3/search      ──► Search memories                      │
│   GET  /v3/profile     ──► Get user profile                     │
└─────────────────────────────────────────────────────────────────┘
```

## Comparison with Claude-Mem

| Feature          | Claude-Mem       | Claude-Supermemory |
| ---------------- | ---------------- | ------------------ |
| Local Backend    | Yes (port 37777) | No                 |
| Local Database   | Yes (SQLite)     | No (cloud)         |
| Dependencies     | Bun, uv, Chroma  | Node.js only       |
| Setup Complexity | High             | Low                |
| Offline Support  | Yes              | No                 |

## Development

```bash
# Test hooks locally
echo '{"cwd":"/your/project"}' | node plugin/scripts/context-hook.js

# Enable debug logging
export SUPERMEMORY_DEBUG=true
```

## License

MIT
