---
name: save-memory
description: Proactively save significant work to long-term memory. Use this skill after completing meaningful tasks - architectural decisions, bug fixes, new patterns, or significant code changes. Also use when the user asks to save or remember something. This skill should be triggered proactively by Claude when significant work has been done.
allowed-tools: ["Bash", "AskUserQuestion"]
---

# Save Memory - Curated Long-Term Memory

You are the memory curator. After significant work, extract what matters and save it for future sessions.

## When to Trigger This

Proactively use this skill when you detect ANY of these:
- An **architectural decision** was made (chose X over Y, and why)
- A **bug was fixed** (what was wrong, root cause, fix)
- A **new pattern** was established (convention, approach, technique)
- **Significant code was written or changed** (new feature, refactor, migration)
- The user explicitly asks to **remember** or **save** something
- A **debugging session** revealed non-obvious behavior
- **Configuration or setup** that was tricky to get right
- A **preference** was expressed ("always use X", "never do Y")

## Step 1: Extract Structured Memory

Summarize what happened into ONE of these categories. Be specific and concise - future Claude sessions will read this.

**Categories:**
- `decision` - Architectural or technical choice with rationale
- `code_change` - Significant implementation with files and purpose
- `bug_fix` - Problem, root cause, and solution
- `pattern` - Established convention or recurring approach
- `preference` - User preference or project rule
- `context` - Important background knowledge for future work
- `debug_insight` - Non-obvious system behavior discovered

## Step 2: Ask the User

Present the extracted memory to the user for approval using AskUserQuestion:

> **Worth remembering for future sessions?**
>
> `[category]` [one-line summary]
>
> [2-3 lines of detail: what, why, key files]

Options: "Save it", "Edit first", "Skip"

If user says "Edit first", let them modify the summary, then save.
If user says "Skip", do not save.

## Step 3: Save to Supermemory

Format the memory as structured text and save:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/add-memory.cjs" "FORMATTED_MEMORY_HERE"
```

**Memory format:**

```
## [category] One-line summary

- **What**: Description of what happened or was decided
- **Why**: Rationale or context
- **Files**: key/files/affected.ts, other/file.ts (if applicable)
- **Date**: YYYY-MM-DD
```

Then mark the activity counter as saved:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mark-saved.cjs" "SESSION_ID"
```

(Get the session ID from the environment or tracker context.)

## Examples

### Decision
```
## [decision] Use BullMQ over Redis pub/sub for job queue

- **What**: Switched signal processing from Redis pub/sub to BullMQ persistent queues
- **Why**: Need retry logic, dead letter queues, and job persistence across restarts
- **Files**: lib/queue/queues.ts, lib/queue/redis.ts, lib/ingest/ingest-signal.ts
- **Date**: 2026-01-30
```

### Bug Fix
```
## [bug_fix] MongoDB vector search returns empty when filter uses $in with ObjectId strings

- **What**: Vector search silently returned 0 results when filter contained string IDs instead of ObjectId instances
- **Why**: MongoDB Atlas vector search filter requires native ObjectId type, not string representation
- **Files**: lib/vectors/mongodb-search.ts
- **Date**: 2026-01-30
```

### Pattern
```
## [pattern] Use Zod schemas at API boundaries, trust internal types

- **What**: Validate with Zod only at API route handlers and external data ingestion. Internal lib/ functions use TypeScript types without runtime validation.
- **Why**: Runtime validation is expensive. Internal code is type-checked at compile time. Only external boundaries can have malformed data.
- **Files**: lib/agents/schemas.ts (boundary validation), lib/agents/types.ts (internal types)
- **Date**: 2026-01-30
```

### Preference
```
## [preference] Never use console.log in production - use Sentry logger

- **What**: All logging must go through lib/logger.ts which routes to Sentry
- **Why**: Console.log is invisible in production. Sentry provides searchable, alertable logs.
- **Files**: lib/logger.ts, lib/sentry-logger.ts
- **Date**: 2026-01-30
```

## Important

- **Be specific** - "fixed a bug" is useless. "MongoDB ObjectId casting fails in vector search filter" is useful.
- **Include file paths** - future sessions need to know WHERE to look.
- **Include rationale** - WHY matters more than WHAT for decisions.
- **Keep it short** - 3-5 lines max. This is a reference, not documentation.
- **One memory per save** - do not batch unrelated things together.
