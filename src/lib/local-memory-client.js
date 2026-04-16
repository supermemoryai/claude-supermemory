const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const MEMORIES_DIR = path.join(os.homedir(), '.supermemory-claude', 'memories');

const PERSONAL_ENTITY_CONTEXT = `Developer coding session transcript. Focus on USER message and intent.

RULES:
- Extract USER's action/intent, not every detail assistant provides
- Condense assistant responses into what user gained from it
- Skip granular facts from assistant output

EXTRACT:
- Research: "researched whisper.cpp for speech recognition"
- Actions: "built auth flow with JWT", "fixed memory leak in useEffect"
- Preferences: "prefers Tailwind over CSS modules"
- Decisions: "chose SQLite for local storage"
- Learnings: "learned about React Server Components"

SKIP:
- Every fact assistant mentions (condense to user's action)
- Generic assistant explanations user didn't confirm/use`;

const REPO_ENTITY_CONTEXT = `Project/codebase knowledge for team sharing.

EXTRACT:
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function containerDir(type, containerTag) {
  return path.join(MEMORIES_DIR, type, containerTag);
}

function loadAllMemories(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const memories = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      memories.push(JSON.parse(raw));
    } catch {
      // skip corrupt files
    }
  }
  return memories;
}

function scoreMemory(memory, queryTokens) {
  const content = (memory.content || '').toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (content.includes(token)) {
      score += 1;
    }
  }
  // Boost recent memories
  const age = Date.now() - new Date(memory.createdAt || 0).getTime();
  const recencyBonus = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)); // decay over 30 days
  return score + recencyBonus * 0.5;
}

class LocalMemoryClient {
  constructor(containerTag) {
    this.containerTag = containerTag || 'default';
  }

  async addMemory(content, containerTag, metadata = {}) {
    const tag = containerTag || this.containerTag;
    const type = metadata.type === 'project-knowledge' ? 'repo' : 'personal';
    const dir = containerDir(type, tag);
    ensureDir(dir);

    const id = crypto.randomUUID();
    const entry = {
      id,
      content,
      metadata: { sm_source: 'claude-code-local', ...metadata },
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry, null, 2));
    return { id, status: 'saved', containerTag: tag };
  }

  async search(query, containerTag, options = {}) {
    const tag = containerTag || this.containerTag;
    const limit = options.limit || 10;

    // Search both personal and repo for this tag
    const personalDir = containerDir('personal', tag);
    const repoDir = containerDir('repo', tag);
    const allMemories = [...loadAllMemories(personalDir), ...loadAllMemories(repoDir)];

    if (allMemories.length === 0) {
      return { results: [], total: 0 };
    }

    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = allMemories
      .map((m) => ({
        memory: m.content || '',
        metadata: m.metadata,
        updatedAt: m.createdAt,
        similarity: queryTokens.length > 0 ? scoreMemory(m, queryTokens) / queryTokens.length : 0,
      }))
      .filter((m) => m.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return { results: scored, total: scored.length };
  }

  async getProfile(containerTag, projectName, maxItems = 5) {
    const tag = containerTag || this.containerTag;
    const personalDir = containerDir('personal', tag);
    const repoDir = containerDir('repo', tag);

    const personalMemories = loadAllMemories(personalDir);
    const repoMemories = loadAllMemories(repoDir);

    // Sort by date descending
    const sortByDate = (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();

    personalMemories.sort(sortByDate);
    repoMemories.sort(sortByDate);

    // Static = repo knowledge, Dynamic = recent personal
    const staticFacts = repoMemories.slice(0, maxItems).map((m) => m.content);
    const dynamicFacts = personalMemories.slice(0, maxItems).map((m) => m.content);

    // Recent search results (most recent memories from both)
    const allRecent = [...personalMemories, ...repoMemories]
      .sort(sortByDate)
      .slice(0, maxItems);

    const searchResults = {
      results: allRecent.map((m) => ({
        id: m.id,
        memory: m.content,
        similarity: 1,
        updatedAt: m.createdAt,
      })),
      total: allRecent.length,
    };

    return {
      profile: { static: staticFacts, dynamic: dynamicFacts },
      searchResults,
    };
  }
}

module.exports = {
  LocalMemoryClient,
  PERSONAL_ENTITY_CONTEXT,
  REPO_ENTITY_CONTEXT,
};
