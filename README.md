<div align="center">

# claude-supermemory

**Persistent memory for Claude Code, powered by [Supermemory](https://supermemory.ai)**

[![version](https://img.shields.io/github/package-json/v/supermemoryai/claude-supermemory/main?filename=plugin%2F.claude-plugin%2Fplugin.json&label=version&color=9C5C10)](https://github.com/supermemoryai/claude-supermemory)
[![license](https://img.shields.io/badge/license-MIT-9C5C10)](#license)
[![Claude Code](https://img.shields.io/badge/Claude_Code-hooks_%2B_MCP-9C5C10)](https://github.com/supermemoryai/claude-supermemory)

<img width="4000" height="2130" alt="claude-supermemory in action" src="https://github.com/user-attachments/assets/07e63ac4-b67d-457b-9029-1dc5d860e920" />

</div>

A Claude Code plugin that gives your agent persistent memory across sessions using
[Supermemory](https://supermemory.ai). Your agent remembers what you worked on, across
sessions and across projects.

<div align="center">

[Install](#installation) · [Features](#features) · [How it works](#how-it-works) · [Shared containers](#shared-agents-memory) · [Configuration](#configuration) · [Commands](#commands) · [Privacy](#privacy)

</div>

---

## Installation

> **Requires Node.js 18+** on your PATH. The memory hooks run as Node scripts.

```bash
/plugin marketplace add supermemoryai/claude-supermemory
/plugin install supermemory
```

Set your API key (get one at [console.supermemory.ai](https://console.supermemory.ai)),
or just start a session and let browser login handle it:

```bash
export SUPERMEMORY_CC_API_KEY="sm_..."
```

<details>
<summary>Migrating from the old <code>claude-supermemory</code> plugin</summary>
<br>

That plugin was renamed to `supermemory`, so it won't update in place. Migrate with:

```bash
/plugin marketplace update supermemory-plugins
/plugin install supermemory@supermemory-plugins
```

Then, only if you still have the old plugin installed, remove it:

```bash
/plugin uninstall claude-supermemory@supermemory-plugins
```

</details>

## Features

|  |  |
| --- | --- |
| 🧠 **Direct recall**<br>Every substantive prompt is searched against Supermemory by the hook itself before Claude sees it, and fresh matches are injected automatically. No permission prompt, no tool call spent. | 🔎 **Hosted MCP tools**<br>`search_memory`, `listSpaces`, `whoAmI`, and more are available through the same credentials as the hooks, auto-approved when read-only. |
| 💾 **Auto capture**<br>Conversations are saved automatically when a session ends. | 🏷️ **Team memory**<br>Project knowledge shared across your team, separate from personal memories, via `sm_scope` metadata. |
| 🧭 **Deep multi-container search**<br>The `context-gatherer` subagent fans out several searches across a project's containers and returns a synthesized brief. | ⚙️ **Project config**<br>Per-repo settings, API keys, and container tag overrides via `.claude/.supermemory-claude/config.json`. |
| 📟 **Live statusline**<br>An animated statusline (installed automatically, opt-out any time) shows recall and capture activity as it happens. | 👋 **Welcome-back notices**<br>Returning to a project after 6+ hours shows a one-line reminder of when you last worked here. |

## How it works

Claude Code supports hooks and MCP servers. `supermemory` registers four hooks, in lifecycle order:

**`SessionStart`** → **`UserPromptSubmit`** → **`PreToolUse`** → **`Stop`**

| Step | Hook | Event | What it does |
| --- | --- | --- | --- |
| 1 | `session-start` | `SessionStart` | Bootstraps auth, installs the statusline on first run, and loads profile context plus a welcome-back notice. |
| 2 | `recall-directive` | `UserPromptSubmit` | Searches Supermemory directly with the prompt and injects fresh matches, deduplicated within the session. |
| 3 | `recall-approve` | `PreToolUse` | Auto-allows read-only Supermemory MCP tools; writes still ask for permission. |
| 4 | `capture` | `Stop` | Saves the completed conversation delta in the background. |

By default, recall is performed by the hook itself, not delegated to the model, so it runs
on every substantive prompt instead of only when Claude chooses to spend a tool call.
Setting `recallDirective` switches to advisory mode: the hook stops searching and instead
tells Claude when it should decide to search on its own.

The hooks are tolerant: if Supermemory is unreachable, the API key is missing, or
anything else fails, they exit cleanly without breaking your Claude Code session.

### Shared Agents memory

Claude Code, Codex, and OpenCode all generate the same container tag for a given
repository, so new memories are shared:

```
repo_<project-name>__<remote-hash>   stores automatic capture and every explicit save
sm_scope                             metadata keeping personal and project memories filterable
```

The hash is derived from the normalized Git remote, so clones share memory while
same-named repositories do not collide. Repositories without a remote fall back to
a local path identity. Set `SUPERMEMORY_ISOLATE_WORKTREES=true` to use the worktree
path instead of the remote identity.

Unlike Codex, this plugin does not read older per-tool legacy containers
(`codex_user_*`, `opencode_project_*`, and similar); it only ever uses the single
unified tag above, generated fresh or overridden via `repoContainerTag` /
`SUPERMEMORY_REPO_TAG`.

## Configuration

### Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPERMEMORY_CC_API_KEY` | Your Supermemory API key (browser auth is preferred). |
| `SUPERMEMORY_API_URL` | Override the Supermemory API base URL. |
| `SUPERMEMORY_MCP_URL` | Override the hosted MCP endpoint (default `https://mcp.supermemory.ai/mcp`). |
| `SUPERMEMORY_AUTH_URL` | Override the browser-auth base URL. |
| `SUPERMEMORY_REPO_TAG` | Explicit project-container override, checked before the project config value. |
| `SUPERMEMORY_ISOLATE_WORKTREES` | Set to `true` to key the project container on the worktree path instead of the Git remote. |
| `SUPERMEMORY_DEBUG` | Set to `true` to enable debug logging. |

### Global settings (`~/.supermemory-claude/settings.json`)

```json
{
  "maxProfileItems": 5,
  "signalExtraction": true,
  "signalKeywords": ["remember", "architecture", "decision", "bug", "fix"],
  "signalTurnsBefore": 3,
  "includeTools": ["Edit", "Write"]
}
```

| Option | Description |
| --- | --- |
| `maxProfileItems` | Max memories in context (default: 5). |
| `injectProfile` | Whether to fetch and inject the user profile (default: true). |
| `recallDirective` | Set to switch prompt recall from direct hook search to an advisory instruction Claude reasons over. |
| `signalExtraction` | Only capture important turns (default: false). |
| `signalKeywords` | Keywords that trigger capture. |
| `signalTurnsBefore` | Context turns before signal (default: 3). |
| `includeTools` | Tool calls to explicitly capture. |
| `debug` | Enable debug logging (default: false). |

### Project config (`.claude/.supermemory-claude/config.json`)

Per-repo overrides, created manually or via the settings your team shares:

```json
{
  "apiKey": "sm_...",
  "baseUrl": "https://api.supermemory.ai",
  "repoContainerTag": "my-team-project",
  "signalExtraction": true
}
```

| Option | Description |
| --- | --- |
| `apiKey` | Project-specific API key. |
| `baseUrl` | Supermemory API URL. |
| `personalContainerTag` | Legacy personal container retained for reads. |
| `repoContainerTag` | Override the unified project container tag. |

## Commands

| Command | Description |
| --- | --- |
| `/supermemory:status` | Show authentication status, API and MCP reachability, and the active project container. |

Search and save no longer go through dedicated commands: recall happens automatically on
every prompt, deeper multi-container search runs through the `context-gatherer` agent or
the MCP tools directly, and saving happens automatically when a session ends.

## Privacy

For information about how Supermemory collects, uses, and retains data, see the
[Supermemory Privacy Policy](https://supermemory.ai/privacy/).

## License

MIT

---

<div align="center">
<sub>◪ is the supermemory mark. Whenever you see it (statusline, notices, Claude's answers), that information came from supermemory.</sub>
</div>
