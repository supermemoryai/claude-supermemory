---
name: supermemory-search
description: Search your coding memory (alias for super-search). Use when user asks about past work, previous sessions, how something was implemented, or wants to recall information from earlier sessions.
allowed-tools: Bash(node:*)
---

# Supermemory Search

Canonical search skill. Legacy alias: `super-search`.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/search-memory.cjs" [--user|--repo|--both] "USER_QUERY_HERE"
```

See `super-search` for full usage examples.
