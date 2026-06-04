---
name: super-save
description: Save important project knowledge to memory. Use when user wants to preserve architectural decisions, significant bug fixes, design patterns, or important implementation details for team reference.
allowed-tools: Bash(node *)
---

# Super Save

Save important project knowledge based on what the user wants to preserve.

## Step 1: Understand User Request

Analyze what the user is asking to save from the conversation.

## Step 2: Format Content

Use this structure, replacing every field with real conversation details before saving:

```
[SAVE:actual-username:YYYY-MM-DD]

Actual user name wanted to solve the concrete goal or problem.

Claude suggested the specific approach or solution.

Actual user name decided the concrete decision or next step.

Key details and relevant files, if any.

[/SAVE]
```

Never save literal placeholders like `<Username>`, `<goal/problem>`, `<date>`, or other angle-bracket template text. If a detail is unknown, omit that sentence or write a short natural sentence using only known facts.

Example:
```
[SAVE:prasanna:2026-02-04]

Prasanna wanted to create a skill for saving project knowledge.

Claude suggested using a separate container tag (repo_<hash>) for shared team knowledge.

Prasanna decided to keep it simple - no transcript fetching, just save what user asks for.

Files: src/save-project-memory.js, src/lib/container-tag.js

[/SAVE]
```

Keep it natural. Capture the conversation flow.

## Step 3: Save

Before running the command, confirm the formatted content contains no angle-bracket placeholders and no unfilled template wording.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/save-project-memory.cjs" "FORMATTED_CONTENT"
```
