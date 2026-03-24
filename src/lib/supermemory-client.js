const Supermemory = require('supermemory').default;
const {
  getRequestIntegrity,
  validateApiKeyFormat,
  validateContainerTag,
} = require('./validate.js');

const DEFAULT_PROJECT_ID = 'claudecode_default';
const API_URL = process.env.SUPERMEMORY_API_URL || 'https://api.supermemory.ai';

function dedupe(items, getKey = (x) => x) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(getKey(item)).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PERSONAL_ENTITY_CONTEXT = `Developer coding session transcript. Focus on USER message and intent.

RULES:
- Extract USER's action/intent, not every detail assistant provides matter
- Condense assistant responses into what user gained from it
- Skip granular facts from assistant output

EXTRACT:
- Research: "researched whisper.cpp for speech recognition"
- Actions: "built auth flow with JWT", "fixed memory leak in useEffect"
- Preferences: "prefers Tailwind over CSS modules"
- Decisions: "chose SQLite for local storage"
- Learnings: "learned about React Server Components"

EXAMPLES:
| Transcript | Memory |
| [role:user] research about the whisper.cpp -> https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp [user:end]| "<User> starts research about whisper.cpp" |
| [role:assistant] ## whisper.cpp Architecture Summary \n This is highly relevant for your parakeet.cpp implementation. Here are the key patterns: \n ### Core Architecture \n **Two-level context design:**\n - whisper_context - holds model weights, vocab, hyperparameters (persistent) \n - whisper_state - runtime state, KV caches, backends (can have multiple per context) [assistant:end] | "Assistant did a deep dive on whisper architecture" |
| [role:user] Can we explain what we are currently doing in this repository? [user:end] | "<Multiple comprehensive memories using assistant reponse>" |

SKIP:
- Every fact assistant mentions (condense to user's action)
- Generic assistant explanations user didn't confirm/use`;

const REPO_ENTITY_CONTEXT = `Project/codebase knowledge for team sharing.

EXTRACT:
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"

EXAMPLES:
| Input | Memory |
| "The auth flow works by..." | "Auth flow: [description]" |
| "We structure components like..." | "Component structure convention: [pattern]" |
| "To add a new API route..." | "Adding API routes: [steps]" |`;

class SupermemoryClient {
  constructor(apiKey, containerTag) {
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
    const defaultHeaders = {
      ...integrityHeaders,
      'x-api-key': apiKey,
    };

    this.client = new Supermemory({
      apiKey,
      baseURL: API_URL,
      defaultHeaders,
    });
    this.client.authHeaders = async () => ({ 'x-api-key': apiKey });
    this.containerTag = tag;
  }

  async addMemory(content, containerTag, metadata = {}, options = {}) {
    const payload = {
      content,
      containerTag: containerTag || this.containerTag,
      metadata: { sm_source: 'claude-code-plugin', ...metadata },
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
    const result = await this.client.search.memories({
      q: query,
      containerTag: containerTag || this.containerTag,
      limit: options.limit || 10,
      searchMode: options.searchMode || 'hybrid',
    });
    const mapped = result.results.map((r) => ({
      memory: r.content || r.memory || r.context || '',
      chunk: r.chunk,
      metadata: r.metadata,
      updatedAt: r.updatedAt,
      similarity: r.similarity,
    }));
    return {
      results: dedupe(mapped, (r) => r.memory),
      total: result.total,
      timing: result.timing,
    };
  }

  async getProfile(containerTag, query) {
    const result = await this.client.profile({
      containerTag: containerTag || this.containerTag,
      q: query,
    });

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
}

module.exports = {
  SupermemoryClient,
  PERSONAL_ENTITY_CONTEXT,
  REPO_ENTITY_CONTEXT,
};
