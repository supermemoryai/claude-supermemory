---
description: Show clickable Supermemory URL for the current ongoing session transcript
allowed-tools: ["Bash", "Read"]
---

# Current Session Document

Show a direct link to the current Claude Code session's transcript in Supermemory.

## Steps

1. Read the session data (prefer the new JSON file):
   ```bash
   cat ~/.supermemory-claude/last-session.json 2>/dev/null || cat ~/.supermemory-claude/last-session-document-id 2>/dev/null || echo ""
   ```

2. If data exists:
   - When it's JSON with `id` + `containerTag`, build:
     `https://app.supermemory.ai/?view=list&project=<containerTag>&doc=<id>`
   - Otherwise fall back to the simple `/documents/<id>` format.

3. Output a clean link:
   ```
   **Supermemory session document:**
   [View in Supermemory](THE_CORRECT_URL)
   ```

4. (Optional on macOS) Also run:
   ```bash
   open "THE_CORRECT_URL" 2>/dev/null || true
   ```

5. If nothing is saved yet:
   ```
   No Supermemory document yet for this session.
   Keep chatting — it will be created automatically on the next autosave.
   ```

Always produce a real working Markdown link (no placeholders).