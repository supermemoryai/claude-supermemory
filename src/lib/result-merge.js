function normalizedKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim();
}

function dedupe(items, getKey = (item) => item) {
  const seen = new Set();
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
  return result.id ? `id:${result.id}` : '';
}

function compareSearchResults(a, b) {
  const aScore = a.similarity ?? -1;
  const bScore = b.similarity ?? -1;
  if (aScore !== bScore) return bScore - aScore;
  const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return bTime - aTime;
}

function mergeSearchResponses(responses, limit = 10) {
  const results = dedupe(
    responses
      .flatMap((response) => response?.results || [])
      .sort(compareSearchResults),
    searchResultKey,
  ).slice(0, limit);
  return {
    results,
    total: results.length,
    timing: Math.max(0, ...responses.map((response) => response?.timing || 0)),
  };
}

function mergeProfileResponses(responses, limit = 10) {
  const staticFacts = dedupe(
    responses.flatMap((response) => response?.profile?.static || []),
  );
  const staticKeys = new Set(staticFacts.map(normalizedKey));
  const dynamicFacts = dedupe(
    responses.flatMap((response) => response?.profile?.dynamic || []),
  ).filter((fact) => !staticKeys.has(normalizedKey(fact)));
  const searchResults = mergeSearchResponses(
    responses.map((response) => response?.searchResults).filter(Boolean),
    limit,
  );
  return {
    profile: { static: staticFacts, dynamic: dynamicFacts },
    searchResults: searchResults.results.length > 0 ? searchResults : undefined,
  };
}

module.exports = { mergeSearchResponses, mergeProfileResponses };
