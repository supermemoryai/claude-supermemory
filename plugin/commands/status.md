---
description: Show Supermemory authentication and connection status
allowed-tools: ["Bash", "Read"]
---

# Supermemory Status

Report the user's Supermemory status:

1. **Probe real connectivity** — a stored key proves nothing by itself. From the current project, run the bundled SDK-backed probe without reading or printing credentials:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/status.js"
   ```
   It resolves the same key source, namespace, REST URL, and API version as the hooks. Interpret loudly: `200` → reachable and the key works; `401` → authentication failed; `403` → permission denied; timeout / connection error / `5xx` → unavailable. `authenticated: false` means no key was found. Never print credentials.
2. Call the `whoAmI` MCP tool if the supermemory MCP server is connected, and say whether the MCP path works too.
3. Report: authenticated or not, key source, the active project namespace, API reachability (with the probe's HTTP status), and MCP reachability.

If not authenticated, tell the user a new session will open the browser login automatically, or they can set `SUPERMEMORY_CC_API_KEY`.
