---
description: Show Supermemory authentication and connection status
allowed-tools: ["Bash", "Read"]
---

# Supermemory Status

Report the user's Supermemory status:

1. From the active project directory, run `node "${CLAUDE_PLUGIN_ROOT}/hooks/status-check.js"`. The probe uses the same credential, project configuration, endpoint precedence, and container-tag implementations as the runtime hooks. It never prints the API key.

2. Interpret the probe loudly: `200` means reachable and authenticated. `401` or `403` means reachable but the key is invalid or revoked. A timeout, connection error, or `5xx` means the API is unavailable; report the exact result.
3. Call the `whoAmI` MCP tool if the Supermemory MCP server is connected. Report whether the MCP path works.
4. Report authentication, key source, active endpoint, active project container tag, API HTTP status, and MCP reachability.

If not authenticated, tell the user a new session will open the browser login automatically, or they can set `SUPERMEMORY_CC_API_KEY`.
