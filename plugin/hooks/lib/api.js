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

// Self-hosted backends sometimes return `score` instead of `similarity`, and
// document-mode hits may nest chunk text under `chunks[]`. Normalize so the
// recall hook's resultText/similarity filter sees a flat, consistent shape.
function normalizeSearchHit(hit) {
  if (!hit || typeof hit !== 'object') return null;
  const similarity = Number.isFinite(hit.similarity)
    ? hit.similarity
    : Number.isFinite(hit.score)
      ? hit.score
      : undefined;
  const filepath =
    (typeof hit.filepath === 'string' && hit.filepath) ||
    (typeof hit.metadata?.filepath === 'string' && hit.metadata.filepath) ||
    undefined;
  return {
    ...hit,
    ...(similarity !== undefined ? { similarity } : {}),
    ...(filepath ? { filepath } : {}),
  };
}

function flattenSearchResults(response) {
  const raw = Array.isArray(response?.results) ? response.results : [];
  const out = [];
  for (const item of raw) {
    if (Array.isArray(item?.chunks) && item.chunks.length > 0) {
      for (const chunk of item.chunks) {
        const text =
          [chunk?.chunk, chunk?.content, chunk?.text, chunk?.memory].find(
            (v) => typeof v === 'string' && v.trim(),
          ) || null;
        const normalized = normalizeSearchHit({
          ...chunk,
          ...(text && !chunk.chunk && !chunk.memory ? { chunk: text } : {}),
          title: chunk.title || item.title,
          filepath: chunk.filepath || item.filepath,
          similarity: chunk.similarity ?? chunk.score ?? item.similarity ?? item.score,
        });
        if (normalized) out.push(normalized);
      }
      continue;
    }
    const normalized = normalizeSearchHit(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

// Per-prompt recall must not depend on /v4/profile's embedded searchResults —
// on self-hosted backends that field stays empty even when /v3/search finds
// real hits (issue #106). Dedicated search keeps cloud and local recall working.
async function searchMemory(baseUrl, apiKey, containerTag, query, options = {}) {
  const body = {
    q: query,
    // Singular is current; plural is what the #106 self-hosted repro used on
    // /v3/search. Send both so neither cloud nor local silently scopes wrong.
    containerTag,
    containerTags: [containerTag],
    limit: options.limit ?? 10,
    searchMode: options.searchMode ?? 'hybrid',
  };
  const response = await post(
    baseUrl,
    apiKey,
    '/v3/search',
    body,
    options.timeoutMs,
  );
  return {
    results: flattenSearchResults(response),
    total: response?.total,
    timing: response?.timing,
  };
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

module.exports = {
  AGENT_ENTITY_CONTEXT,
  getProfile,
  searchMemory,
  addMemory,
};
