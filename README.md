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

Start a Claude Code session after installation. Supermemory opens a browser
window where you can sign in and choose the organization this plugin should
use. You can alternatively provide a key explicitly:

```bash
export SUPERMEMORY_CC_API_KEY="sm_..."
```

## How It Works

- **Reasoned recall** — Before each turn, Claude decides whether recalling memory would actually help your current message, and only searches when it's worth it — every turn, once in a while, or not at all. The search runs automatically (no permission prompt), just like auto-capture. Searching only when needed also keeps more usage on your plan
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
| `/supermemory:switch-org`     | Choose and connect a different organization |

### Switching organizations

Run `/supermemory:switch-org`, choose an organization in the browser, and
approve the connection. The plugin verifies the new key and organization before
replacing the saved credential, so cancelling or failing the flow keeps the
previous credential. After a successful switch, run `/reload-plugins` or
restart Claude Code because the running MCP proxy retains the key it loaded at
startup.

`SUPERMEMORY_CC_API_KEY` and a project-level `apiKey` take precedence over the
saved browser credential. The switch command warns when either override is
present.

## Configuration

**Environment**

```bash
SUPERMEMORY_CC_API_KEY=sm_...    # Optional: overrides browser credentials
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
| `personalContainerTag` | Legacy personal container retained for reads |
| `repoContainerTag`     | Override unified project container tag |

## Privacy

For information about how Supermemory collects, uses, and retains data, see the
[Supermemory Privacy Policy](https://supermemory.ai/privacy/).

## License

MIT
