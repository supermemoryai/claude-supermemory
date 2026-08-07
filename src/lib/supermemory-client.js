const Supermemory = require('supermemory').default;
const {
  getRequestIntegrity,
  validateApiKeyFormat,
  validateContainerTag,
} = require('./validate.js');
const { BASE_URL } = require('./constants');
const {
  mergeSearchResponses,
  mergeProfileResponses,
} = require('./result-merge');

const DEFAULT_PROJECT_ID = 'claudecode_default';

function dedupe(items, getKey = (x) => x) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(getKey(item)).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getScopeFilters(scope) {
  return {
    AND: [{ key: 'sm_scope', value: scope, filterType: 'metadata' }],
  };
}

function supportsScopedCanonicalTag(containerTag) {
  return /^repo_.+__[0-9a-f]{16}$/i.test(containerTag);
}

const AGENT_ENTITY_CONTEXT = `Shared coding-agent memory for one software repository.

RULES:
- Preserve durable context that helps Claude Code, Codex, OpenCode, or Cursor continue the work
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
- Generic assistant suggestions the user did not accept
- Transient command output and low-value implementation chatter
- Granular details that do not help future work`;

const PERSONAL_ENTITY_CONTEXT = AGENT_ENTITY_CONTEXT;
const REPO_ENTITY_CONTEXT = AGENT_ENTITY_CONTEXT;

class SupermemoryClient {
  constructor(apiKey, containerTag, options = {}) {
    if (!apiKey) throw new Error('SUPERMEMORY_CC_API_KEY is required');

    const keyCheck = validateApiKeyFormat(apiKey);
    if (!keyCheck.valid) {
      throw new Error(`Invalid API key: ${keyCheck.reason}`);
    }

    const tag = containerTag || DEFAULT_PROJECT_ID;
    const tagCheck = validateContainerTag(tag);
    if (!tagCheck.valid) {
      console.warn(`Container tag warning: ${tagCheck.reason}`);
    }

    const integrityHeaders = getRequestIntegrity(apiKey, tag);

    this.client = new Supermemory({
      apiKey,
      baseURL: options.baseUrl || BASE_URL,
      defaultHeaders: { ...integrityHeaders, 'x-sm-source': 'claude-code' },
    });
    this.containerTag = tag;
  }

  async addMemory(content, containerTag, metadata = {}, options = {}) {
    const payload = {
      content,
      containerTag: containerTag || this.containerTag,
      metadata: { sm_source: 'claude-code', ...metadata },
    };
    if (options.customId) payload.customId = options.customId;
    if (options.entityContext) payload.entityContext = options.entityContext;
    const result = await this.client.add(payload);
    return {
      id: result.id,
      status: result.status,
      containerTag: containerTag || this.containerTag,
    };
  }

  async search(query, containerTag, options = {}) {
    const payload = {
      q: query,
      containerTag: containerTag || this.containerTag,
      limit: options.limit || 10,
      searchMode: options.searchMode || 'hybrid',
    };
    if (options.filters) payload.filters = options.filters;
    const result = await this.client.search.memories(payload);
    const mapped = result.results.map((r) => ({
      id: r.id,
      memory: r.content || r.memory || r.context || '',
      chunk: r.chunk,
      title: r.title,
      metadata: r.metadata,
      updatedAt: r.updatedAt,
      similarity: r.similarity,
      containerTag: containerTag || this.containerTag,
    }));
    return {
      results: dedupe(mapped, (r) => r.memory),
      total: result.total,
      timing: result.timing,
    };
  }

  async searchMany(query, containerTags, options = {}) {
    const tags = [...new Set(containerTags.filter(Boolean))];
    const settled = await Promise.allSettled(
      tags.map((tag) => this.search(query, tag, options)),
    );
    const successful = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === 'rejected');
      throw (
        firstError?.reason ||
        new Error('No memory containers could be searched')
      );
    }
    return mergeSearchResponses(successful, options.limit || 10);
  }

  async searchScoped(query, canonicalTag, containerTags, scope, options = {}) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag)),
    ];
    const canonicalOptions = supportsScopedCanonicalTag(canonicalTag)
      ? { ...options, filters: getScopeFilters(scope) }
      : options;
    const settled = await Promise.allSettled([
      this.search(query, canonicalTag, canonicalOptions),
      ...legacyTags.map((tag) => this.search(query, tag, options)),
    ]);
    const successful = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === 'rejected');
      throw (
        firstError?.reason ||
        new Error('No memory containers could be searched')
      );
    }
    return mergeSearchResponses(successful, options.limit || 10);
  }

  async getProfile(containerTag, query, options = {}) {
    const payload = {
      containerTag: containerTag || this.containerTag,
      q: query,
    };
    if (options.filters) payload.filters = options.filters;
    const result = await this.client.profile(payload);

    // Dedupe across static, dynamic, and search results
    const seen = new Set();
    const dedupeWithSeen = (items, getKey = (x) => x) =>
      items.filter((item) => {
        const key = String(getKey(item)).toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const staticFacts = dedupeWithSeen(result.profile?.static || []);
    const dynamicFacts = dedupeWithSeen(result.profile?.dynamic || []);

    let searchResults;
    if (result.searchResults) {
      const mapped = result.searchResults.results.map((r) => ({
        id: r.id,
        memory: r.content || r.context || '',
        similarity: r.similarity,
        title: r.title,
        updatedAt: r.updatedAt,
      }));
      searchResults = {
        results: dedupeWithSeen(mapped, (r) => r.memory),
        total: result.searchResults.total,
        timing: result.searchResults.timing,
      };
    }

    return {
      profile: { static: staticFacts, dynamic: dynamicFacts },
      searchResults,
    };
  }

  async getProfileMany(containerTags, query, options = {}) {
    const tags = [...new Set(containerTags.filter(Boolean))];
    const settled = await Promise.allSettled(
      tags.map((tag) => this.getProfile(tag, query, options)),
    );
    const successful = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === 'rejected');
      throw (
        firstError?.reason || new Error('No memory profiles could be loaded')
      );
    }
    return mergeProfileResponses(successful, options.limit || 10);
  }

  async getProfileScoped(
    canonicalTag,
    containerTags,
    scope,
    query,
    options = {},
  ) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag)),
    ];
    const canonicalOptions = supportsScopedCanonicalTag(canonicalTag)
      ? { ...options, filters: getScopeFilters(scope) }
      : options;
    const settled = await Promise.allSettled([
      this.getProfile(canonicalTag, query, canonicalOptions),
      ...legacyTags.map((tag) => this.getProfile(tag, query)),
    ]);
    const successful = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === 'rejected');
      throw (
        firstError?.reason || new Error('No memory profiles could be loaded')
      );
    }
    return mergeProfileResponses(successful, options.limit || 10);
  }
}

module.exports = {
  SupermemoryClient,
  AGENT_ENTITY_CONTEXT,
  PERSONAL_ENTITY_CONTEXT,
  REPO_ENTITY_CONTEXT,
};
