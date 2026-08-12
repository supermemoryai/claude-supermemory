var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/validate.js
var validate_exports = {};
__export(validate_exports, {
  getRequestIntegrity: () => F,
  sanitizeContent: () => m,
  sanitizeMetadata: () => x,
  validateApiKeyFormat: () => h,
  validateContainerTag: () => v,
  validateContentLength: () => A,
  validateRecallConfig: () => E
});
function h(e) {
  return !e || typeof e !== "string" ? { valid: false, reason: "key is empty or not a string" } : e.startsWith("sm_") ? e.length < 20 ? { valid: false, reason: "key is too short" } : /\s/.test(e) ? { valid: false, reason: "key contains whitespace" } : { valid: true } : { valid: false, reason: "key must start with sm_ prefix" };
}
function v(e) {
  return !e || typeof e !== "string" ? { valid: false, reason: "tag is empty" } : e.length > 100 ? { valid: false, reason: "tag exceeds 100 characters" } : /^[a-zA-Z0-9_-]+$/.test(e) ? /^[-_]|[-_]$/.test(e) ? { valid: false, reason: "tag must not start or end with - or _" } : { valid: true } : { valid: false, reason: "tag contains invalid characters (only alphanumeric, underscore, hyphen allowed)" };
}
function m(e, n = 1e5) {
  if (!e || typeof e !== "string") return "";
  let t = e;
  for (const r of u) t = t.replace(r, "");
  return t.length > n && (t = t.slice(0, n)), t;
}
function A(e, n = 1, t = 1e5) {
  return e.length < n ? { valid: false, reason: `content below minimum length (${n})` } : e.length > t ? { valid: false, reason: `content exceeds maximum length (${t})` } : { valid: true };
}
function x(e) {
  let n = {}, t = 0;
  for (const [r, i] of Object.entries(e)) {
    if (t >= f) break;
    r.length > g || /[^\w.-]/.test(r) || (typeof i === "string" ? (n[r] = i.slice(0, c), t++) : (typeof i === "number" && Number.isFinite(i) || typeof i === "boolean") && (n[r] = i, t++));
  }
  return n;
}
function E(e, n) {
  const t = [];
  return (!Number.isInteger(e) || e < 1 || e > 20) && t.push("maxRecallResults must be an integer between 1 and 20"), (!Number.isInteger(n) || n < 1 || n > 500) && t.push("profileFrequency must be an integer between 1 and 500"), t;
}
function s(e) {
  return (0, import_node_crypto.createHash)("sha256").update(e).digest("hex");
}
function p(e, n) {
  const t = [s(e), s(n), a].join(":");
  return (0, import_node_crypto.createHmac)("sha256", d).update(t).digest("base64url");
}
function F(e, n) {
  const t = s(n), r = p(e, n);
  return { "X-Content-Hash": t, "X-Request-Integrity": [`v${a}`, r].join(".") };
}
var import_node_crypto, u, f, g, c, a, d;
var init_validate = __esm({
  "src/lib/validate.js"() {
    import_node_crypto = require("node:crypto");
    u = [/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, /\uFEFF/g, /[\uFFF0-\uFFFF]/g];
    f = 50;
    g = 128;
    c = 1024;
    a = 1;
    d = "7f2a9c4b8e1d6f3a5c0b9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a";
  }
});

// src/lib/constants.js
var require_constants = __commonJS({
  "src/lib/constants.js"(exports2, module2) {
    var BASE_URL2 = "https://api.supermemory.ai";
    module2.exports = {
      BASE_URL: BASE_URL2
    };
  }
});

// src/lib/result-merge.js
var require_result_merge = __commonJS({
  "src/lib/result-merge.js"(exports2, module2) {
    function normalizedKey(value) {
      return String(value ?? "").toLowerCase().trim();
    }
    function dedupe2(items, getKey = (item) => item) {
      const seen = /* @__PURE__ */ new Set();
      return items.filter((item) => {
        const key = normalizedKey(getKey(item));
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function searchResultKey(result) {
      const content = normalizedKey(result.memory);
      if (content) return `content:${content}`;
      return result.id ? `id:${result.id}` : "";
    }
    function compareSearchResults(a2, b) {
      const aScore = a2.similarity ?? -1;
      const bScore = b.similarity ?? -1;
      if (aScore !== bScore) return bScore - aScore;
      const aTime = a2.updatedAt ? Date.parse(a2.updatedAt) : 0;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bTime - aTime;
    }
    function mergeSearchResponses2(responses, limit = 10) {
      const results = dedupe2(
        responses.flatMap((response) => response?.results || []).sort(compareSearchResults),
        searchResultKey
      ).slice(0, limit);
      return {
        results,
        total: results.length,
        timing: Math.max(0, ...responses.map((response) => response?.timing || 0))
      };
    }
    function mergeProfileResponses2(responses, limit = 10) {
      const staticFacts = dedupe2(
        responses.flatMap((response) => response?.profile?.static || [])
      );
      const staticKeys = new Set(staticFacts.map(normalizedKey));
      const dynamicFacts = dedupe2(
        responses.flatMap((response) => response?.profile?.dynamic || [])
      ).filter((fact) => !staticKeys.has(normalizedKey(fact)));
      const searchResults = mergeSearchResponses2(
        responses.map((response) => response?.searchResults).filter(Boolean),
        limit
      );
      return {
        profile: { static: staticFacts, dynamic: dynamicFacts },
        searchResults: searchResults.results.length > 0 ? searchResults : void 0
      };
    }
    module2.exports = { mergeSearchResponses: mergeSearchResponses2, mergeProfileResponses: mergeProfileResponses2 };
  }
});

// src/lib/supermemory-client.js
var Supermemory = require("supermemory").default;
var {
  getRequestIntegrity,
  validateApiKeyFormat,
  validateContainerTag
} = (init_validate(), __toCommonJS(validate_exports));
var { BASE_URL } = require_constants();
var {
  mergeSearchResponses,
  mergeProfileResponses
} = require_result_merge();
var DEFAULT_PROJECT_ID = "claudecode_default";
function dedupe(items, getKey = (x2) => x2) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const key = String(getKey(item)).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function getScopeFilters(scope) {
  return {
    AND: [{ key: "sm_scope", value: scope, filterType: "metadata" }]
  };
}
function supportsScopedCanonicalTag(containerTag) {
  return /^repo_.+__[0-9a-f]{16}$/i.test(containerTag);
}
var AGENT_ENTITY_CONTEXT = `Shared coding-agent memory for one software repository.

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
var PERSONAL_ENTITY_CONTEXT = AGENT_ENTITY_CONTEXT;
var REPO_ENTITY_CONTEXT = AGENT_ENTITY_CONTEXT;
var SupermemoryClient = class {
  constructor(apiKey, containerTag, options = {}) {
    if (!apiKey) throw new Error("SUPERMEMORY_CC_API_KEY is required");
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
      defaultHeaders: { ...integrityHeaders, "x-sm-source": "claude-code" }
    });
    this.containerTag = tag;
  }
  async addMemory(content, containerTag, metadata = {}, options = {}) {
    const payload = {
      content,
      containerTag: containerTag || this.containerTag,
      metadata: { sm_source: "claude-code", ...metadata }
    };
    if (options.customId) payload.customId = options.customId;
    if (options.entityContext) payload.entityContext = options.entityContext;
    const result = await this.client.add(payload);
    return {
      id: result.id,
      status: result.status,
      containerTag: containerTag || this.containerTag
    };
  }
  async search(query, containerTag, options = {}) {
    const payload = {
      q: query,
      containerTag: containerTag || this.containerTag,
      limit: options.limit || 10,
      searchMode: options.searchMode || "hybrid"
    };
    if (options.filters) payload.filters = options.filters;
    const result = await this.client.search.memories(payload);
    const mapped = result.results.map((r) => ({
      id: r.id,
      memory: r.content || r.memory || r.context || r.chunk || "",
      chunk: r.chunk,
      metadata: r.metadata,
      updatedAt: r.updatedAt,
      similarity: r.similarity,
      containerTag: containerTag || this.containerTag
    }));
    return {
      results: dedupe(mapped, (r) => r.memory || r.id),
      total: result.total,
      timing: result.timing
    };
  }
  async searchMany(query, containerTags, options = {}) {
    const tags = [...new Set(containerTags.filter(Boolean))];
    const settled = await Promise.allSettled(
      tags.map((tag) => this.search(query, tag, options))
    );
    const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === "rejected");
      throw firstError?.reason || new Error("No memory containers could be searched");
    }
    return mergeSearchResponses(successful, options.limit || 10);
  }
  async searchScoped(query, canonicalTag, containerTags, scope, options = {}) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag))
    ];
    const canonicalOptions = supportsScopedCanonicalTag(canonicalTag) ? { ...options, filters: getScopeFilters(scope) } : options;
    const settled = await Promise.allSettled([
      this.search(query, canonicalTag, canonicalOptions),
      ...legacyTags.map((tag) => this.search(query, tag, options))
    ]);
    const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === "rejected");
      throw firstError?.reason || new Error("No memory containers could be searched");
    }
    return mergeSearchResponses(successful, options.limit || 10);
  }
  async getProfile(containerTag, query, options = {}) {
    const payload = {
      containerTag: containerTag || this.containerTag,
      q: query
    };
    if (options.filters) payload.filters = options.filters;
    const result = await this.client.profile(payload);
    const seen = /* @__PURE__ */ new Set();
    const dedupeWithSeen = (items, getKey = (x2) => x2) => items.filter((item) => {
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
        memory: r.content || r.context || r.chunk || "",
        similarity: r.similarity,
        title: r.title,
        updatedAt: r.updatedAt
      }));
      searchResults = {
        results: dedupeWithSeen(mapped, (r) => r.memory || r.id),
        total: result.searchResults.total,
        timing: result.searchResults.timing
      };
    }
    return {
      profile: { static: staticFacts, dynamic: dynamicFacts },
      searchResults
    };
  }
  async getProfileMany(containerTags, query, options = {}) {
    const tags = [...new Set(containerTags.filter(Boolean))];
    const settled = await Promise.allSettled(
      tags.map((tag) => this.getProfile(tag, query, options))
    );
    const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === "rejected");
      throw firstError?.reason || new Error("No memory profiles could be loaded");
    }
    return mergeProfileResponses(successful, options.limit || 10);
  }
  async getProfileScoped(canonicalTag, containerTags, scope, query, options = {}) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag))
    ];
    const canonicalOptions = supportsScopedCanonicalTag(canonicalTag) ? { ...options, filters: getScopeFilters(scope) } : options;
    const settled = await Promise.allSettled([
      this.getProfile(canonicalTag, query, canonicalOptions),
      ...legacyTags.map((tag) => this.getProfile(tag, query))
    ]);
    const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (successful.length === 0) {
      const firstError = settled.find((result) => result.status === "rejected");
      throw firstError?.reason || new Error("No memory profiles could be loaded");
    }
    return mergeProfileResponses(successful, options.limit || 10);
  }
};
module.exports = {
  SupermemoryClient,
  AGENT_ENTITY_CONTEXT,
  PERSONAL_ENTITY_CONTEXT,
  REPO_ENTITY_CONTEXT
};
