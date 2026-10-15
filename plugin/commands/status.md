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
   It resolves the same key source, namespace, REST URL, and API version as the hooks. Interpret `200` with `authenticated: true` as profile access working; `401` as authentication failed; `403` as permission denied, not proof of bad credentials. `404` means the endpoint responded but the profile may be absent or the route unsupported; authentication remains unknown (`null`), not valid or invalid. Timeout / connection error / `5xx` means unavailable. `authenticated: false` without an HTTP status means no key was found. An invalid v5 namespace diagnostic means no request was sent: report the named scope-setting keys, never invent a new scope or suggest changing credentials. Never print credentials.
2. Call the `whoAmI` MCP tool if the supermemory MCP server is connected, and say whether the MCP path works too.
3. Report: authenticated, not authenticated, or unknown as the probe actually establishes, key source, the active project namespace, API reachability (with the probe's HTTP status), and MCP reachability.

If no key was found, tell the user a new session will open the browser login automatically, or they can set `SUPERMEMORY_CC_API_KEY`. Do not prescribe re-authentication for `404` or a namespace validation error.
