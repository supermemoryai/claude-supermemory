const RECALL_MIN_SIMILARITY = 0.55;
const CHARS_PER_TOKEN = 4;

function singleLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resultText(result) {
  return (
    [
      result?.memory,
      result?.chunk,
      result?.content,
      result?.text,
      result?.context,
    ]
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim() || ''
  );
}

function stringValue(...values) {
  return values
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
}

function provenance(result) {
  const metadata =
    result?.metadata && typeof result.metadata === 'object'
      ? result.metadata
      : {};
  return {
    title: stringValue(result?.title, metadata.title),
    filepath: stringValue(
      result?.filepath,
      result?.filePath,
      result?.path,
      metadata.filepath,
      metadata.filePath,
      metadata.path,
    ),
  };
}

function normalizeText(value) {
  return singleLine(value).toLowerCase();
}

function dedupe(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeText(keyFor(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function score(result) {
  if (Number.isFinite(result.similarity)) return result.similarity;
  if (Number.isFinite(result.score)) return result.score;
  return null;
}

function mergeProfileResults(responses, maxMemories) {
  const staticFacts = dedupe(
    responses.flatMap((response) => response?.profile?.static || []),
    (fact) => fact,
  );
  const staticKeys = new Set(staticFacts.map(normalizeText));
  const dynamicFacts = dedupe(
    responses.flatMap((response) => response?.profile?.dynamic || []),
    (fact) => fact,
  ).filter((fact) => !staticKeys.has(normalizeText(fact)));

  const searchResults = dedupe(
    responses
      .flatMap((response) => response?.searchResults?.results || [])
      .filter((result) => resultText(result))
      .filter((result) => {
        const relevance = score(result);
        return relevance === null || relevance >= RECALL_MIN_SIMILARITY;
      })
      .sort((a, b) => {
        const relevance = (score(b) ?? -1) - (score(a) ?? -1);
        if (relevance !== 0) return relevance;
        return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
      }),
    (result) => resultText(result) || result.id,
  )
    .slice(0, Math.max(0, maxMemories))
    .map((result) => ({
      ...result,
      memory: resultText(result),
      ...provenance(result),
    }));

  return {
    profile: { static: staticFacts, dynamic: dynamicFacts },
    searchResults: { results: searchResults },
  };
}

function getRecallContainerTags(containerTag, config) {
  return [
    ...new Set([
      containerTag,
      ...(config.autoRecallContainers === true
        ? config.customContainers.map((container) => container.tag.trim())
        : []),
    ]),
  ];
}

function formatBoundedItems(items, maxTokens, limitName, render) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new RangeError(`${limitName} must be a positive number`);
  }
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  if (render('').length > maxChars) {
    throw new RangeError(`${limitName} is too small for fixed recall context`);
  }

  let body = '';
  const newFacts = [];
  for (const item of items) {
    const fullBody = `${body}${item.before}${item.text}`;
    if (render(fullBody).length <= maxChars) {
      body = fullBody;
      if (item.fact) newFacts.push(item.fact);
      continue;
    }

    const fixedBody = `${body}${item.before}`;
    const available = maxChars - render(fixedBody).length;
    if (available > 1) {
      const truncated = (item.truncateText || item.text).slice(
        0,
        available - 1,
      );
      const emitted = `${truncated}…`;
      body = `${fixedBody}${emitted}`;
      if (item.fact && truncated.length > (item.factOffset || 0)) {
        newFacts.push(`${truncated.slice(item.factOffset || 0)}…`);
      }
    }
    break;
  }
  return { text: newFacts.length > 0 ? render(body) : '', newFacts };
}

function formatRecallContext(results, options) {
  const customContainers = options.customContainers || [];
  const render = (body) => `<supermemory-recall>
◪ Recalled from supermemory for this prompt (relevance-ranked):
${body}

When one of these shapes your answer, credit it naturally with the ◪ prefix (e.g. "◪ earlier you decided X"); if you name the source, say "from supermemory" — never "from memory". For deeper history, call the supermemory search_memory tool or launch the context-gatherer agent.
</supermemory-recall>`;
  const items = results.map((result, index) => {
    const memory = singleLine(result.memory);
    const title = singleLine(result.title);
    const filepath = singleLine(result.filepath);
    const factPrefix = '- ◪ ';
    return {
      before: index === 0 ? '' : '\n',
      fact: memory,
      text: `- ◪ ${title && !memory.startsWith(title) ? `${title} — ` : ''}${memory}${filepath ? ` (${filepath})` : ''}`,
      truncateText: `${factPrefix}${memory}`,
      factOffset: factPrefix.length,
    };
  });
  items.push({
    before: '\n\n',
    fact: null,
    text: `Recall container: ${singleLine(options.containerTag)}`,
  });
  if (customContainers.length) {
    items.push({
      before: '\n',
      fact: null,
      text: 'Configured automatic recall containers:',
    });
    items.push(
      ...customContainers.map((container) => ({
        before: '\n',
        fact: null,
        text: `- ${singleLine(container.tag)}: ${singleLine(container.description)}`,
      })),
    );
  }
  return formatBoundedItems(
    items,
    options.maxTokens,
    'maxPromptRecallTokens',
    render,
  );
}

function formatSessionContext(result, options) {
  const take = (facts) =>
    facts
      .map((fact) => singleLine(fact))
      .filter(Boolean)
      .slice(0, Math.max(0, options.maxProfileItems));
  const facts = [
    ...take(result?.profile?.static || []),
    ...take(result?.profile?.dynamic || []),
  ];
  const render = (body) => `<supermemory-context>
Recalled memory for this project. Every line marked ◪ comes from supermemory — when citing one, keep the mark and phrase it naturally. If you name the source, say "from supermemory" — never "from memory".

${body}
</supermemory-context>`;
  const items = facts.map((fact, index) => {
    const factPrefix = `${index + 1}. ◪ `;
    return {
      before: index === 0 ? '[Memory Profile]\n' : '\n',
      fact,
      text: `${factPrefix}${fact}`,
      factOffset: factPrefix.length,
    };
  });
  items.push(
    {
      before: '\n\n',
      fact: null,
      text: `Project: ${singleLine(options.projectName)}`,
    },
    {
      before: '\n',
      fact: null,
      text: `Memory container: ${singleLine(options.containerTag)}`,
    },
  );
  return formatBoundedItems(
    items,
    options.maxTokens,
    'maxRecallTokens',
    render,
  );
}

module.exports = {
  formatRecallContext,
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
  normalizeText,
  resultText,
};
