const CONTEXT_INTRO =
  'The following is recalled context. Reference it only when relevant to the conversation.';
const CONTEXT_DISCLAIMER =
  "Use these memories naturally when relevant — including indirect connections — but don't force them into every response or make assumptions beyond what's stated.";

function formatRelativeTime(isoTimestamp) {
  try {
    const dt = new Date(isoTimestamp);
    const now = new Date();
    const seconds = (now.getTime() - dt.getTime()) / 1000;
    const minutes = seconds / 60;
    const hours = seconds / 3600;
    const days = seconds / 86400;

    if (minutes < 30) return 'just now';
    if (minutes < 60) return `${Math.floor(minutes)}mins ago`;
    if (hours < 24) return `${Math.floor(hours)}hrs ago`;
    if (days < 7) return `${Math.floor(days)}d ago`;

    const month = dt.toLocaleString('en', { month: 'short' });
    if (dt.getFullYear() === now.getFullYear()) {
      return `${dt.getDate()} ${month}`;
    }
    return `${dt.getDate()} ${month}, ${dt.getFullYear()}`;
  } catch {
    return '';
  }
}

function formatContext(
  profileResult,
  includeProfile = true,
  includeRelevantMemories = false,
  maxResults = 10,
  wrapWithTags = true,
) {
  if (!profileResult) return null;

  const statics = includeProfile
    ? (profileResult.profile?.static || []).slice(0, maxResults)
    : [];
  const dynamics = includeProfile
    ? (profileResult.profile?.dynamic || []).slice(0, maxResults)
    : [];
  const search = includeRelevantMemories
    ? (profileResult.searchResults?.results || []).slice(0, maxResults)
    : [];

  if (statics.length === 0 && dynamics.length === 0 && search.length === 0) {
    return null;
  }

  const sections = [];

  if (statics.length > 0) {
    const items = statics.map((f) => `- ${f}`).join('\n');
    sections.push(`## User Profile (Persistent)\n${items}`);
  }

  if (dynamics.length > 0) {
    const items = dynamics.map((f) => `- ${f}`).join('\n');
    sections.push(`## Recent Context\n${items}`);
  }

  if (search.length > 0) {
    const lines = search.map((r) => {
      const memory = r.memory ?? '';
      const timeStr = r.updatedAt ? formatRelativeTime(r.updatedAt) : '';
      const pct =
        r.similarity != null ? `[${Math.round(r.similarity * 100)}%]` : '';
      const prefix = timeStr ? `[${timeStr}] ` : '';
      const label = r.title ? `${r.title}: ` : '';
      return `- ${prefix}${label}${memory} ${pct}`.trim();
    });
    sections.push(
      `## Relevant Memories (with relevance %)\n${lines.join('\n')}`,
    );
  }

  const content = sections.join('\n\n');

  if (!wrapWithTags) {
    return content;
  }

  return `<supermemory-context>\n${CONTEXT_INTRO}\n\n${content}\n\n${CONTEXT_DISCLAIMER}\n</supermemory-context>`;
}

function combineContexts(contexts) {
  const validContexts = contexts.filter((c) => c.content);

  if (validContexts.length === 0) {
    return null;
  }

  const sections = validContexts.map((c) => {
    if (c.label) {
      return `${c.label}\n\n${c.content}`;
    }
    return c.content;
  });

  return `<supermemory-context>\n${CONTEXT_INTRO}\n\n${sections.join('\n\n---\n\n')}\n\n${CONTEXT_DISCLAIMER}\n</supermemory-context>`;
}

function formatSearchResults(query, results, label) {
  const header = label
    ? `${label} memories for "${query}"`
    : `Memories for "${query}"`;

  if (!results || results.length === 0) {
    return `No ${label ? `${label.toLowerCase()} ` : ''}memories found for "${query}"`;
  }

  const lines = results.map((r) => {
    const memory = r.memory ?? '';
    const timeStr = r.updatedAt ? formatRelativeTime(r.updatedAt) : '';
    const pct =
      r.similarity != null ? `[${Math.round(r.similarity * 100)}%]` : '';
    const prefix = timeStr ? `[${timeStr}] ` : '';
    const label = r.title ? `${r.title}: ` : '';
    return `${prefix}${label}${memory} ${pct}`.trim();
  });

  return `${header}\n${lines.join('\n')}`;
}

module.exports = {
  formatContext,
  combineContexts,
  formatRelativeTime,
  formatSearchResults,
};
