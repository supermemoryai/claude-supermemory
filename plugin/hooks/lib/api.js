const { resolveApiVersion } = require('./settings');

const AGENT_SUPPORTING_CONTEXT = `Shared coding-agent memory for one software repository.

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

const REQUEST_TIMEOUT_MS = 3000;

async function post(
  baseUrl,
  apiKey,
  path,
  body,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
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

function useV5(baseUrl, options) {
  return resolveApiVersion(baseUrl, options.apiVersion) === 'v5';
}

function sdkClient(baseUrl, apiKey, options) {
  const { Supermemory } = require('../vendor/supermemory.cjs');
  return new Supermemory({
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    headers: { 'x-sm-source': 'claude-code' },
    timeoutInSeconds: (options.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000,
    maxRetries: 0,
  });
}

function sdkOptions(options) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return {
    timeoutInSeconds: timeoutMs / 1000,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
  };
}

async function getProfile(baseUrl, apiKey, namespace, query, options = {}) {
  if (!useV5(baseUrl, options)) {
    return post(
      baseUrl,
      apiKey,
      '/v4/profile',
      { containerTag: namespace, q: query },
      options.timeoutMs,
    );
  }
  const response = await sdkClient(baseUrl, apiKey, options).profile(
    namespace,
    {},
    sdkOptions(options),
  );
  if (
    !Array.isArray(response?.profile?.static) ||
    !Array.isArray(response?.profile?.dynamic)
  ) {
    throw new Error('Supermemory returned an invalid profile response.');
  }
  return response;
}

async function searchMemories(baseUrl, apiKey, namespace, query, options = {}) {
  if (!useV5(baseUrl, options)) {
    const response = await getProfile(
      baseUrl,
      apiKey,
      namespace,
      query,
      options,
    );
    return response?.searchResults?.results || [];
  }
  const response = await sdkClient(baseUrl, apiKey, options).search(
    namespace,
    {
      query,
      searchMode: 'memories',
      threshold: 0.55,
      limit: 5,
      rerank: 'none',
      rewriteQuery: false,
    },
    sdkOptions(options),
  );
  if (!Array.isArray(response?.results)) {
    throw new Error('Supermemory returned an invalid search response.');
  }
  return response.results;
}

async function addMemory(
  baseUrl,
  apiKey,
  content,
  namespace,
  metadata,
  options = {},
) {
  if (useV5(baseUrl, options)) {
    const result = await sdkClient(baseUrl, apiKey, options).add(
      namespace,
      {
        content,
        id: options.id ?? options.customId,
        supportingContext: options.supportingContext ?? options.entityContext,
        metadata: { sm_source: 'claude-code', ...metadata },
        taskType: 'memory',
        dreaming: 'dynamic',
      },
      sdkOptions(options),
    );
    if (
      typeof result?.id !== 'string' ||
      !result.id ||
      ![
        'unknown',
        'queued',
        'extracting',
        'chunking',
        'embedding',
        'indexing',
        'done',
      ].includes(result.status)
    ) {
      throw new Error(
        'Supermemory did not confirm document acceptance; capture cursor retained.',
      );
    }
    return result;
  }
  const body = {
    content,
    containerTag: namespace,
    metadata: { sm_source: 'claude-code', ...metadata },
  };
  if (options.id ?? options.customId)
    body.customId = options.id ?? options.customId;
  if (options.supportingContext ?? options.entityContext)
    body.entityContext = options.supportingContext ?? options.entityContext;
  const result = await post(
    baseUrl,
    apiKey,
    '/v3/documents',
    body,
    options.timeoutMs,
  );
  if (typeof result?.id !== 'string' || !result.id) {
    throw new Error(
      'Supermemory did not confirm document acceptance; capture cursor retained.',
    );
  }
  return result;
}

module.exports = {
  AGENT_SUPPORTING_CONTEXT,
  AGENT_ENTITY_CONTEXT: AGENT_SUPPORTING_CONTEXT,
  getProfile,
  searchMemories,
  addMemory,
};
