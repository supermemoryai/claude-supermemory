# Claude-Supermemory

<img width="4000" height="2130" alt="image (6)" src="https://github.com/user-attachments/assets/07e63ac4-b67d-457b-9029-1dc5d860e920" />

> **✨ Requires [Supermemory Pro or above](https://app.supermemory.ai/?view=integrations)** - Unlock the state of the art memory for your Claude code.

A Claude Code plugin that gives your AI persistent memory across sessions using [Supermemory](https://supermemory.ai).
Your agent remembers what you worked on - across sessions, across projects.

## Features

- **Team Memory** — Project knowledge shared across your team, separate from personal memories
- **Auto Capture** — Conversations saved when session ends
- **Project Config** — Per-repo settings, API keys, and container tags
- **Custom Container Tags** — Define custom memory containers (e.g., `work`, `personal`, `code_style`). The AI automatically routes memories to the right container based on your descriptions

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

All memory commands support `--container <tag>` to target a specific custom container when custom containers are enabled.

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

| Option                       | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `maxProfileItems`            | Max memories in context (default: 5)          |
| `signalExtraction`           | Only capture important turns (default: false) |
| `signalKeywords`             | Keywords that trigger capture                 |
| `signalTurnsBefore`          | Context turns before signal (default: 3)      |
| `includeTools`               | Tools to explicitly capture                   |
| `enableCustomContainers`     | Enable AI-driven container routing (default: false) |
| `customContainers`           | Array of `{tag, description}` container definitions |
| `customContainerInstructions`| Free-text instructions for AI on routing      |

**Project Config** — `.claude/.supermemory-claude/config.json`

Per-repo overrides. Run `/claude-supermemory:project-config` or create manually:

```json
{
  "apiKey": "sm_...",
  "repoContainerTag": "my-team-project",
  "signalExtraction": true
}
```

| Option                       | Description                          |
| ---------------------------- | ------------------------------------ |
| `apiKey`                     | Project-specific API key             |
| `personalContainerTag`       | Override personal container          |
| `repoContainerTag`           | Override team container tag          |
| `enableCustomContainers`     | Enable custom container routing      |
| `customContainers`           | Project-specific container definitions |
| `customContainerInstructions`| Project-specific routing instructions |

## Custom Container Tags

Custom container tags let you organize memories into separate buckets (e.g., `work`,
`personal`, `code_style`). The AI reads the container descriptions from your config
and automatically picks the right container when saving memories.

### Setup

Add these fields to `~/.supermemory-claude/settings.json`:

```json
{
  "enableCustomContainers": true,
  "customContainers": [
    { "tag": "personal", "description": "Personal life — family, health, hobbies, routines" },
    { "tag": "work", "description": "Work-related — projects, deadlines, meetings, colleagues" },
    { "tag": "code_style", "description": "Coding preferences — languages, tools, patterns, conventions" }
  ],
  "customContainerInstructions": "Route coding preferences to code_style. Personal topics to personal. Default to project container for ambiguous content."
}
```

You can also set these per-project in `.claude/.supermemory-claude/config.json`.

### How it works

1. You define containers with a `tag` (identifier) and a `description` (plain English
   explaining what belongs there).
2. On session start, the container catalog is injected into the AI's context so it knows
   what containers are available.
3. When the AI saves a memory, it picks the best matching container based on the
   descriptions and uses `--container <tag>`.
4. When searching, the AI can also target specific containers.
5. Auto-capture (background saving at session end) always goes to the default
   personal/repo containers — only explicit saves get routed to custom containers.
6. Invalid container tags are rejected with a list of valid options, preventing
   orphaned spaces.

Each container tag automatically becomes a **Space** on the
[Supermemory dashboard](https://app.supermemory.ai), so you can view and manage
memories organized by category.

### Container config reference

| Field              | Type     | Description                                        |
| ------------------ | -------- | -------------------------------------------------- |
| `tag`              | `string` | Unique identifier for the container (e.g. `work`). |
| `description`      | `string` | Plain English description for AI routing.           |

## License

MIT
