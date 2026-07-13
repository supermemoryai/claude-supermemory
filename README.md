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

> **Requires Node.js 18+** on your PATH — the memory hooks run as Node scripts.

```bash
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install supermemory
```

> **Already have the old `claude-supermemory` plugin installed?** It was renamed to `supermemory`, so it won't update in place. Migrate with:
>
> ```bash
> /plugin marketplace update supermemory-plugins
> /plugin install supermemory@supermemory-plugins
> ```
>
> Then, **only if you still have the old plugin**, remove it:
>
> ```bash
> /plugin uninstall claude-supermemory@supermemory-plugins
> ```

Set your API key (get one at [app.supermemory.ai](https://app.supermemory.ai)):

```bash
export SUPERMEMORY_CC_API_KEY="sm_..."
```

## How It Works

- **Reasoned recall** — Before each turn, Claude decides whether recalling memory would actually help your current message, and only searches when it's worth it — every turn, once in a while, or not at all. The search runs automatically (no permission prompt), just like auto-capture. Searching only when needed also keeps more usage on your plan
- **supermemory-search** — Ask about past work or previous sessions, Claude searches your memories
- **supermemory-save** — Ask to save something important, Claude saves it for the team

### Shared Agents memory

Claude Code and `codex-supermemory` use the same two containers for a repository:

- `user_project_<path-hash>` stores automatic session capture and explicit personal memories.
- `repo_<project-name>` stores explicitly saved project knowledge.

Both plugins write only to the shared containers and read from them plus the previous
`claudecode_project_*`, `codex_user_*`, and `codex_project_*` containers. Existing
memories remain searchable without duplicating or migrating them. Linked worktrees
share the same path-scoped personal container unless
`SUPERMEMORY_ISOLATE_WORKTREES=true` is set.

Explicit `personalContainerTag`/`repoContainerTag` project overrides take precedence.
For compatibility, explicit `userContainerTag`/`projectContainerTag` values in
`~/.codex/supermemory.json` are also honored, so Claude Code and Codex continue to
write to the same custom containers.

## Commands

| Command                              | Description                              |
| ------------------------------------ | ---------------------------------------- |
| `/supermemory:index`          | Index codebase architecture and patterns |
| `/supermemory:project-config` | Configure project-level settings         |
| `/supermemory:logout`         | Clear saved credentials                  |
| `/supermemory:session`        | Show clickable URL for the current session document in Supermemory |
| `/supermemory:status`         | Show authentication status |

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
| `recallDirective`   | Override the built-in reasoned-recall instruction Claude is given |
| `signalExtraction`  | Only capture important turns (default: false) |
| `signalKeywords`    | Keywords that trigger capture                 |
| `signalTurnsBefore` | Context turns before signal (default: 3)      |
| `includeTools`      | Tools to explicitly capture                   |

**Project Config** — `.claude/.supermemory-claude/config.json`

Per-repo overrides. Run `/supermemory:project-config` or create manually:

```json
{
  "apiKey": "sm_...",
  "baseUrl": "https://api.supermemory.ai",
  "repoContainerTag": "my-team-project",
  "signalExtraction": true
}
```

| Option                 | Description                 |
| ---------------------- | --------------------------- |
| `apiKey`               | Project-specific API key    |
| `baseUrl`              | Supermemory API URL    |
| `personalContainerTag` | Override personal container |
| `repoContainerTag`     | Override team container tag |

## License

MIT
