const AGENT_ENTITY_CONTEXT = `Shared coding-agent memory for one software repository.

RULES:
- Try to remember things that a human would remember — a teammate recalls decisions and lessons, not what state the working tree was in
- Preserve durable context that helps a coding agent continue the work
- Condense assistant responses into decisions, outcomes, and reusable knowledge
- Keep user preferences and project facts concise and independently understandable

EXTRACT:
- User preferences, accepted decisions, durable workflows, actions, and learnings
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"

SKIP:
- Transient repo state git already tracks: uncommitted file lists, current branch position, in-flight commit/push status
- Generic assistant suggestions the user did not accept
- Transient command output and low-value implementation chatter
- Granular details that do not help future work`;

// Hooks sit between the user and Claude — a slow or dead network must never
// hold the session hostage. Requests default to 3s; prompt recall allows 4s.
// Callers treat failure as "no memory this time", not a blocker.
const REQUEST_TIMEOUT_MS = 3000;

async function post(baseUrl, apiKey, path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'x-sm-source': 'claude-code',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`Supermemory API ${response.status}: ${text.slice(0, 200)}`),
      { status: response.status },
    );
  }
  return response.json();
}

function getProfile(baseUrl, apiKey, containerTag, query, options = {}) {
  return post(baseUrl, apiKey, '/v4/profile', { containerTag, q: query }, options.timeoutMs);
}

function addMemory(baseUrl, apiKey, content, containerTag, metadata, options = {}) {
  const body = {
    content,
    containerTag,
    metadata: { sm_source: 'claude-code', ...metadata },
  };
  if (options.customId) body.customId = options.customId;
  if (options.entityContext) body.entityContext = options.entityContext;
  return post(baseUrl, apiKey, '/v3/documents', body, options.timeoutMs);
}

module.exports = { AGENT_ENTITY_CONTEXT, getProfile, addMemory };
