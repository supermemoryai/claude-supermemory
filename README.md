# Claude-Supermemory

<img width="4000" height="2130" alt="image (6)" src="https://github.com/user-attachments/assets/07e63ac4-b67d-457b-9029-1dc5d860e920" />

> **✨ Requires [Supermemory Pro or above](https://app.supermemory.ai/?view=integrations)** - Unlock the state of the art memory for your Claude code.

A Claude Code plugin that gives your AI persistent memory across sessions using [Supermemory](https://supermemory.ai).
Your agent remembers what you worked on - across sessions, across projects.

## Features

- **Team Memory** — Project knowledge shared across your team, separate from personal memories
- **Auto Capture** — Conversations saved when session ends
- **Project Config** — Per-repo settings, API keys, and container tags

## Installation

```bash
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install claude-supermemory
```

Set your API key (get one at [app.supermemory.ai](https://app.supermemory.ai)):

```bash
export SUPERMEMORY_CC_API_KEY="sm_..."
```

## How It Works

- **super-search** — Ask about past work or previous sessions, Claude searches your memories
- **super-save** — Ask to save something important, Claude saves it for the team

## Commands

| Command                              | Description                              |
| ------------------------------------ | ---------------------------------------- |
| `/claude-supermemory:index`          | Index codebase architecture and patterns |
| `/claude-supermemory:project-config` | Configure project-level settings         |
| `/claude-supermemory:logout`         | Clear saved credentials                  |

## Configuration

**Environment**

```bash
SUPERMEMORY_CC_API_KEY=sm_...    # Required
SUPERMEMORY_DEBUG=true           # Optional: enable debug logging
```

**Global Settings** — `~/.supermemory-claude/settings.json`

```json
{
  "maxProfileItems": 5,
  "signalExtraction": true,
  "signalKeywords": ["remember", "architecture", "decision", "bug", "fix"],
  "signalTurnsBefore": 3,
  "includeTools": ["Edit", "Write"]
}
```

| Option              | Description                                   |
| ------------------- | --------------------------------------------- |
| `maxProfileItems`   | Max memories in context (default: 5)          |
| `signalExtraction`  | Only capture important turns (default: false) |
| `signalKeywords`    | Keywords that trigger capture                 |
| `signalTurnsBefore` | Context turns before signal (default: 3)      |
| `includeTools`      | Tools to explicitly capture                   |

**Project Config** — `.claude/.supermemory-claude/config.json`

Per-repo overrides. Run `/claude-supermemory:project-config` or create manually:

```json
{
  "apiKey": "sm_...",
  "repoContainerTag": "my-team-project",
  "signalExtraction": true
}
```

| Option                 | Description                 |
| ---------------------- | --------------------------- |
| `apiKey`               | Project-specific API key    |
| `personalContainerTag` | Override personal container |
| `repoContainerTag`     | Override team container tag |

## License

MIT
