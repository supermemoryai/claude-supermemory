# Claude-Supermemory

<img width="4000" height="2130" alt="image (6)" src="https://github.com/user-attachments/assets/07e63ac4-b67d-457b-9029-1dc5d860e920" />

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

Set your API key (get one at [console.supermemory.ai](https://console.supermemory.ai)):

```bash
export SUPERMEMORY_CC_API_KEY="sm_..."
```

## How It Works

- **Automatic recall** — Every substantive prompt searches the repository and configured recall containers, then injects globally ranked, deduplicated matches within the configured context budget
- **supermemory-search** — Ask about past work or previous sessions, Claude searches your memories
- **supermemory-save** — Ask to save something important, Claude saves it for the team

### Shared Agents memory

Claude Code, Codex, and OpenCode use one container for a repository:

- `repo_<project-name>__<remote-hash>` stores automatic capture and every explicit save.
- `sm_scope` metadata keeps personal and project memories filterable inside that container.

The hash is derived from the normalized Git remote, so clones share memory while
same-named repositories do not collide. Repositories without a remote fall back to
a local path identity. The agent plugins also read the previous `user_project_*`,
`repo_<project-name>`, `claudecode_project_*`, `codex_user_*`,
`codex_project_*`, `opencode_user_*`, and `opencode_project_*` containers, so
existing memories remain searchable without a migration. Set
`SUPERMEMORY_ISOLATE_WORKTREES=true` to use the worktree path instead of the
remote identity.

Explicit `repoContainerTag`/`projectContainerTag` overrides remain the canonical
write destination. Older personal/user overrides remain in the legacy read set.

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

Claude reads only the six recall options below from
`~/.codex/supermemory.json` when that file exists. Claude-specific settings
override those shared values; unrelated Codex options never alter Claude.
When both clients use the same saved API key, Claude also uses Codex's saved
API base URL. Environment and project-specific URL overrides still take priority.

```json
{
  "maxMemories": 15,
  "maxProfileItems": 15,
  "maxRecallTokens": 5000,
  "maxPromptRecallTokens": 2000,
  "autoRecallContainers": true,
  "customContainers": [
    { "tag": "coding_personal", "description": "Cross-project coding preferences." }
  ],
  "signalExtraction": true,
  "signalKeywords": ["remember", "architecture", "decision", "bug", "fix"],
  "signalTurnsBefore": 3,
  "includeTools": ["Edit", "Write"]
}
```

| Option                    | Description |
| ------------------------- | ----------- |
| `maxMemories`             | Maximum globally ranked prompt matches across all searched containers (default: 5) |
| `maxProfileItems`         | Maximum static and dynamic profile items per section (default: 5) |
| `maxRecallTokens`         | Approximate whole-context SessionStart budget (default: 2500) |
| `maxPromptRecallTokens`   | Approximate whole-context prompt-recall budget (default: 500) |
| `autoRecallContainers`    | Search every valid `customContainers` entry automatically (default: false) |
| `customContainers`        | Additional recall containers with `tag` and `description` fields |
| `recallDirective`         | Replace automatic prompt recall with a custom advisory instruction |
| `signalExtraction`        | Only capture important turns (default: false) |
| `signalKeywords`          | Keywords that trigger capture |
| `signalTurnsBefore`       | Context turns before signal (default: 3) |
| `includeTools`            | Tools to explicitly capture |

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
| `personalContainerTag` | Legacy personal container retained for reads |
| `repoContainerTag`     | Override unified project container tag |

## Privacy

For information about how Supermemory collects, uses, and retains data, see the
[Supermemory Privacy Policy](https://supermemory.ai/privacy/).

## License

MIT
