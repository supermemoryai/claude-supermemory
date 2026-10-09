<div align="center">

# claude-supermemory

**Persistent memory for Claude Code, powered by [Supermemory](https://supermemory.ai)**

[![version](https://img.shields.io/github/package-json/v/supermemoryai/claude-supermemory/main?filename=plugin%2F.claude-plugin%2Fplugin.json&label=version&color=9C5C10)](https://github.com/supermemoryai/claude-supermemory)
[![license](https://img.shields.io/badge/license-MIT-9C5C10)](#license)

<img width="4000" height="2130" alt="Conceptual overview of Claude Code and Supermemory" src="https://github.com/user-attachments/assets/07e63ac4-b67d-457b-9029-1dc5d860e920" />

<sub>Conceptual overview. Some command names in the image predate the current plugin; see <a href="#commands">Commands</a> for what's available now.</sub>

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
| 🧠 **Direct recall**<br>When authenticated, the hook searches substantive prompts before Claude sees them and injects fresh matches. No permission prompt or MCP tool call. | 🔎 **Hosted MCP tools**<br>`search_memory`, `listSpaces`, `whoAmI`, and more are available through the same credentials as the hooks, auto-approved when read-only. |
| 💾 **Auto capture**<br>At the end of a session, the Stop hook saves new conversation content in the background. It asks Supermemory to retain durable context rather than transient Git state. | 🏷️ **Shared repo memory**<br>Automatic captures use the repository container shared with Codex and OpenCode and carry `sm_scope: personal` metadata. |
| 🧭 **Deep multi-container search**<br>The `context-gatherer` subagent fans out several searches across a project's containers and returns a synthesized brief. | ⚙️ **Project config**<br>Per-repo settings, API keys, and container tag overrides via `.claude/.supermemory-claude/config.json`. |
| 🗂️ **Codebase index**<br>`/supermemory:index` saves architecture, conventions, and how to run into this project's container. | 👋 **Session context**<br>Loads profile facts at session start and shows a welcome-back notice when you return to a project after 6+ hours. |

- **Recall strip** — On Claude Code 2.1.287+ in the terminal, press the changing memory headline above the prompt to browse the full returned facts one at a time

On Claude Code 2.1.250, local marketplace install/update and the `SessionStart` and `UserPromptSubmit` command hooks were verified, but `claude plugin validate` rejects the recall mod's `classic.SessionStart` event. The strip is not available on that version; other older versions and install sources have not been verified.

## How it works

Claude Code supports hooks and MCP servers. `supermemory` registers four hooks, in lifecycle order:

**`SessionStart`** → **`UserPromptSubmit`** → **`PreToolUse`** → **`Stop`**

| Step | Hook | Event | What it does |
| --- | --- | --- | --- |
| 1 | `session-start` | `SessionStart` | Bootstraps auth and loads profile context plus a welcome-back notice. It does not install a statusline; an old auto-installed one is removed. |
| 2 | `recall-directive` | `UserPromptSubmit` | Searches Supermemory directly with the prompt and injects fresh matches, deduplicated within the session. |
| 3 | `recall-approve` | `PreToolUse` | Auto-allows read-only Supermemory MCP tools; writes still ask for permission. |
| 4 | `capture` | `Stop` | Saves the completed conversation delta in the background. |

By default, recall is performed by the hook itself, not delegated to the model. It searches
substantive prompts when authenticated, without waiting for Claude to choose a tool call.
Setting `recallDirective` switches to advisory mode: the hook stops searching and instead
tells Claude when it should decide to search on its own.

The hooks are tolerant: if Supermemory is unreachable, the API key is missing, or
anything else fails, they exit cleanly without breaking your Claude Code session.
A capture that fails is reported the next time a session starts.

### API v5 and existing installations

Hosted REST hooks use the official `supermemory` 5.0.1 SDK. SessionStart reads a
profile; prompt recall makes a separate memory search with explicit mode
`memories`, threshold `0.55`, limit `5`, no reranking, and no query rewriting.
The client still enforces the 0.55 floor and top-five cap and renders 300-character
excerpts. Profiles read `{id, memory}` entries from static and dynamic sections;
custom buckets don't change the existing UI. Backend score/ranking parity and
historical data availability haven't been verified against a live service.

Existing custom REST URLs default to `legacy`, keeping v3 writes and v4 profiles
for self-hosted servers older than 0.0.9. After upgrading the server, explicitly
set `SUPERMEMORY_API_VERSION=v5` or project `apiVersion: "v5"`. The environment
setting takes precedence; `legacy` is also an explicit rollback option for a
server that still supports v3/v4. Invalid values fail closed for memory operations.
There is no automatic version fallback after a failed request and no fallback to
the hosted API. REST, MCP, and browser-auth URLs remain separate.

`namespace` is the canonical project-scope name. Precedence is project
`namespace`, project `repoContainerTag`, `SUPERMEMORY_NAMESPACE`,
`SUPERMEMORY_REPO_TAG`, then the unchanged generated identity. Old overrides
remain valid: to rename a setting, copy its **exact value**, not a new identifier.
The migration guide says existing container tags are valid namespace identifiers;
the plugin never renames, merges, deletes, or backfills backend data. Changing a
scope value selects another space, rather than migrating existing memories.
Credentials and key-source precedence are unchanged: `SUPERMEMORY_CC_API_KEY`,
project `apiKey`, then `~/.supermemory-claude/credentials.json`.

Capture uses POST with the existing session ID as v5 `id`, which is documented to
append/diff rather than replace earlier content; extraction instructions become
`supportingContext` and metadata is retained. It explicitly uses the memory
pipeline and dynamic processing, which can take minutes to appear in recall.
SDK automatic retries are disabled for every call. Capture keeps its 25-second
budget; startup and recall keep their 3/4-second budgets. Only a valid acceptance
response advances capture's existing atomic JSON/pending/txt cursors. A timeout
can still mean the server accepted a write without the client receiving its
acknowledgment; stable IDs don't prove exactly-once billing or processing.
Original txt recovery, settings, credentials, and last-session files remain
readable without destructive conversion. Signal/tool/minimum-content behavior
and the recall mod are unchanged.

MCP is a separate tool protocol: its `containerTag` arguments and custom
`SUPERMEMORY_MCP_URL` are intentionally retained. Indexing and the context-gatherer
continue using those MCP tools, not REST document or namespace-management calls.

### Shared Agents memory

Claude Code, Codex, and OpenCode all generate the same container tag for a given
repository, so new memories are shared:

```text
repo_<project-name>__<remote-hash>   default container for capture and MCP memory tools
sm_scope: personal                   metadata on automatic captures
```

The hash is derived from the normalized Git remote, so clones share memory while
same-named repositories do not collide. Repositories without a remote fall back to
a local path identity. Set `SUPERMEMORY_ISOLATE_WORKTREES=true` to use the worktree
path instead of the remote identity.

Unlike Codex, this plugin does not read older per-tool legacy containers
(`codex_user_*`, `opencode_project_*`, and similar); it only ever uses the single
unified identity above, overridden via `namespace` / `SUPERMEMORY_NAMESPACE`
or the compatible `repoContainerTag` / `SUPERMEMORY_REPO_TAG` settings.

## Configuration

### Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPERMEMORY_CC_API_KEY` | Your Supermemory API key (browser auth is preferred). |
| `SUPERMEMORY_API_URL` | Override the Supermemory REST base URL; custom URLs default to legacy compatibility. |
| `SUPERMEMORY_API_VERSION` | `v5` or `legacy`; overrides project `apiVersion`. |
| `SUPERMEMORY_MCP_URL` | Override the hosted MCP endpoint (default `https://mcp.supermemory.ai/mcp`). |
| `SUPERMEMORY_AUTH_URL` | Override the browser-auth base URL. |
| `SUPERMEMORY_REPO_TAG` | Legacy project-scope override; used when no project scope or canonical environment override is set. |
| `SUPERMEMORY_NAMESPACE` | Canonical namespace override; project scope settings take precedence. |
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
  "namespace": "my-team-project",
  "signalExtraction": true
}
```

| Option | Description |
| --- | --- |
| `apiKey` | Project-specific API key. |
| `baseUrl` | Supermemory API URL. |
| `apiVersion` | Explicit `v5` or `legacy`; see the compatibility defaults above. |
| `namespace` | Canonical project scope, preserving the exact old container-tag value. |
| `repoContainerTag` | Override the unified project container tag. Checked before `SUPERMEMORY_REPO_TAG`. |

## Commands

| Command | Description |
| --- | --- |
| `/supermemory:index` | Index this repo's architecture, conventions, and how to run into the project container. |
| `/supermemory:status` | Show authentication status, API and MCP reachability, and the active project container. |

Search does not have its own command. With a key, the prompt hook searches
substantive prompts. For deeper history, use the `context-gatherer` agent or
the MCP tools. `/supermemory:index` saves codebase structure. For a one-off
save, ask Claude to use the `add_memory` MCP tool. Without `containerTag`,
the proxy defaults it to this repository's container; pass a different tag
to select another space. Conversation turns are saved when a session ends.

## Privacy

For information about how Supermemory collects, uses, and retains data, see the
[Supermemory Privacy Policy](https://supermemory.ai/privacy/).

## License

MIT

## Development runtime

Marketplace installations need only Node 18 or later, not `npm install`.
`plugin/hooks/vendor/supermemory.cjs` is the committed runtime bundle built from
the exact official SDK and esbuild versions in `package-lock.json`. Maintainers
reproduce it with `npm ci && npm run build:sdk`; CI rejects a stale bundle.
The SDK's Apache-2.0 license is included alongside the generated bundle.

---

<div align="center">
<sub>◪ is the supermemory mark. Whenever you see it (the recall strip, notices, or Claude's answers), that information came from supermemory.</sub>
</div>
