---
description: Show Supermemory authentication and connection status
allowed-tools: ["Bash", "Read", "mcp__supermemory__whoAmI", "mcp__plugin_supermemory_supermemory__whoAmI", "mcp__claude_ai_supermemory__whoAmI"]
---

# Supermemory Status

Report the user's Supermemory status:

1. Read `~/.supermemory-claude/credentials.json` (may not exist). Never print the full API key — show at most the first 6 and last 4 characters.
2. If a key is configured (env or file), you MUST call whichever `whoAmI` tool variant is available (`mcp__supermemory__whoAmI`, `mcp__plugin_supermemory_supermemory__whoAmI`, or `mcp__claude_ai_supermemory__whoAmI`) to prove the endpoint is actually reachable — do not infer reachability from the key's presence alone. If none of those tools resolve, the MCP server isn't connected; report that explicitly rather than skipping the check silently.
3. Report: authenticated or not, key source (env `SUPERMEMORY_CC_API_KEY` beats credentials file), the active project container tag, and a live reachability verdict — "reachable" only after a successful `whoAmI` call, "unreachable" if the call errored or returned auth failure, "MCP server not connected" if no `whoAmI` tool was available at all.

If not authenticated, tell the user a new session will open the browser login automatically, or they can set `SUPERMEMORY_CC_API_KEY`.
