---
description: Choose which Supermemory organization this plugin uses
allowed-tools: ["Bash"]
---

# Switch Supermemory Organization

Run the bundled organization switcher exactly once and show its complete output
to the user. Never read or print either the old or new API key.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/switch-org.js"
```

The switcher opens Supermemory's browser authorization page even when saved
credentials already exist. If it succeeds, remind the user to follow its
`/reload-plugins` or restart instruction before calling Supermemory MCP tools.
