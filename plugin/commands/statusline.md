---
name: statusline
description: Set up Supermemory statusline in Claude Code. Shows memory count, search activity, and sync status — powered by supermemory.ai
allowed-tools: Bash(node:*), Read(*), Edit(*)
---

# Supermemory Statusline Setup

Set up the Supermemory statusline segment for Claude Code. This shows live memory activity right in the user's statusline:

- **`supermemory 7 injected`** — memories loaded at session start  
- **`supermemory syncing`** — session being saved to supermemory.ai  
- **`supermemory saved`** — session just saved successfully  
- **`supermemory → 4 results`** — recent memory search result count  

## Setup Steps

1. **Read** `~/.claude/settings.json`
2. **Check** if `statusLine` already exists
3. **Patch** the statusline to include the Supermemory segment

### If there's NO existing statusline

Set this as the statusline:

```json
{
  "statusLine": {
    "type": "command",
    "command": "sm=$(node ~/.claude/plugins/cache/supermemory-plugins/supermemory/0.0.8/scripts/statusline.cjs 2>/dev/null); [ -n \"$sm\" ] && printf '\\033[35m%s\\033[0m' \"$sm\""
  }
}
```

### If there's an EXISTING statusline command

Carefully integrate the Supermemory segment without breaking what's already there:

1. Add this variable capture near the top of the existing command (alongside other variable captures):
   ```
   sm=$(node ~/.claude/plugins/cache/supermemory-plugins/supermemory/0.0.8/scripts/statusline.cjs 2>/dev/null);
   ```

2. Add this segment where the output is built (typically near the end, before the final `printf`):
   ```
   [ -n "$sm" ] && out="${out}${s}${SM}${sm}${R}";
   ```
   
   Where `$s` is the separator, `$MG` is Supermemory brand blue (#3B35F3) (`\033[38;2;59;53;243m`), and `$R` is reset (`\033[0m`).
   If the existing command uses different variable names, adapt accordingly.

## Important Rules

- **NEVER replace** the user's existing statusline — only append to it
- Use **Supermemory brand blue (#3B35F3)** (`\033[38;2;59;53;243m`) for the Supermemory segment color
- Always suppress stderr: `2>/dev/null`
- The plugin root path is: `~/.claude/plugins/cache/supermemory-plugins/supermemory/0.0.8`
- After editing, confirm the change looks correct and tell the user to restart their session

## After Setup

Tell the user:
> Statusline configured! You'll see **supermemory** status in your statusline on next session.
> It shows injected memories, sync status, and search results.
> Powered by [supermemory.ai](https://supermemory.ai)
