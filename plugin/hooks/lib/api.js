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
// hold the session hostage, so every request is capped hard at 3s and callers
// treat failure as "no memory this time", not a blocker.
const REQUEST_TIMEOUT_MS = 3000;

async function post(
  baseUrl,
  apiKey,
  path,
  body,
  timeoutMs = REQUEST_TIMEOUT_MS,
  expectedStatus,
) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'x-sm-source': 'claude-code',
    },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (
    !response.ok ||
    (expectedStatus !== undefined && response.status !== expectedStatus)
  ) {
    const text = await response.text().catch(() => '');
    throw Object.assign(
      new Error(`Supermemory API ${response.status}: ${text.slice(0, 200)}`),
      { status: response.status },
    );
  }
  return response.json().catch((error) => {
    throw Object.assign(error, { status: response.status });
  });
}

function getProfile(baseUrl, apiKey, containerTag, query, options = {}) {
  return post(
    baseUrl,
    apiKey,
    '/v4/profile',
    { containerTag, q: query },
    options.timeoutMs,
    200,
  );
}

async function getProfiles(
  baseUrl,
  apiKey,
  containerTags,
  query,
  options = {},
) {
  const settled = await Promise.allSettled(
    [...new Set(containerTags.filter(Boolean))].map((containerTag) =>
      getProfile(baseUrl, apiKey, containerTag, query, options),
    ),
  );
  const profiles = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (profiles.length === 0) {
    const failures = settled
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    throw failures.find((failure) => failure?.status !== 404) || failures[0];
  }
  return profiles;
}

function addMemory(
  baseUrl,
  apiKey,
  content,
  containerTag,
  metadata,
  options = {},
) {
  const body = {
    content,
    containerTag,
    metadata: { sm_source: 'claude-code', ...metadata },
  };
  if (options.customId) body.customId = options.customId;
  if (options.entityContext) body.entityContext = options.entityContext;
  return post(baseUrl, apiKey, '/v3/documents', body, options.timeoutMs);
}

module.exports = { AGENT_ENTITY_CONTEXT, getProfile, getProfiles, addMemory };
