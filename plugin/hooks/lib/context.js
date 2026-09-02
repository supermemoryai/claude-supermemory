const RECALL_MIN_SIMILARITY = 0.55;
const CHARS_PER_TOKEN = 4;

function singleLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resultText(result) {
  return [
    result?.memory,
    result?.chunk,
    result?.content,
    result?.text,
    result?.context,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function stringValue(...values) {
  return values.find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )?.trim();
}

function provenance(result) {
  const metadata =
    result?.metadata && typeof result.metadata === 'object' ? result.metadata : {};
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

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .trim();
}

function dedupe(items, keyFor) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalize(keyFor(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function score(result) {
  if (Number.isFinite(result.similarity)) return result.similarity;
  if (Number.isFinite(result.score)) return result.score;
  return -1;
}

function mergeProfileResults(responses, maxMemories) {
  const staticFacts = dedupe(
    responses.flatMap((response) => response?.profile?.static || []),
    (fact) => fact,
  );
  const staticKeys = new Set(staticFacts.map(normalize));
  const dynamicFacts = dedupe(
    responses.flatMap((response) => response?.profile?.dynamic || []),
    (fact) => fact,
  ).filter((fact) => !staticKeys.has(normalize(fact)));

  const searchResults = dedupe(
    responses
      .flatMap((response) => response?.searchResults?.results || [])
      .filter((result) => resultText(result))
      .filter((result) => {
        const relevance = score(result);
        return relevance < 0 || relevance >= RECALL_MIN_SIMILARITY;
      })
      .sort((a, b) => {
        const relevance = score(b) - score(a);
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
      ...(config.autoRecallContainers
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
    const fullBody = `${body}${item.before}${item.prefix}${item.text}${item.suffix}`;
    if (render(fullBody).length <= maxChars) {
      body = fullBody;
      newFacts.push(item.text);
      continue;
    }

    const fixedBody = `${body}${item.before}${item.prefix}${item.suffix}`;
    const available = maxChars - render(fixedBody).length;
    if (available > 1) {
      const emitted = `${item.text.slice(0, available - 1)}…`;
      body = `${body}${item.before}${item.prefix}${emitted}${item.suffix}`;
      newFacts.push(emitted);
    }
    break;
  }
  return { text: newFacts.length > 0 ? render(body) : '', newFacts };
}

function formatRecallContext(results, options) {
  const customContainers = options.customContainers || [];
  const catalog = customContainers.length
    ? `\n\nConfigured automatic recall containers:\n${customContainers
        .map(
          (container) =>
            `- ${singleLine(container.tag)}: ${singleLine(container.description)}`,
        )
        .join('\n')}`
    : '';
  const render = (body) => `<supermemory-recall>
◪ Recalled from supermemory for this prompt (relevance-ranked):
${body}${catalog}

When one of these shapes your answer, credit it naturally with the ◪ prefix (e.g. "◪ earlier you decided X"); if you name the source, say "from supermemory" — never "from memory". For deeper history, call the supermemory search_memory tool (containerTag: "${options.containerTag}") or launch the context-gatherer agent.
</supermemory-recall>`;
  const items = results.slice(0, Math.max(0, options.maxMemories)).map((result, index) => {
    const memory = singleLine(result.memory);
    const title = singleLine(result.title);
    const filepath = singleLine(result.filepath);
    return {
      before: index === 0 ? '' : '\n',
      prefix: `- ◪ ${title && !memory.startsWith(title) ? `${title} — ` : ''}`,
      text: memory,
      suffix: filepath ? ` (${filepath})` : '',
    };
  });
  return formatBoundedItems(
    items,
    options.maxTokens,
    'maxPromptRecallTokens',
    render,
  );
}

function formatSessionContext(result, options) {
  const take = (facts) =>
    dedupe(facts, (fact) => fact)
      .map((fact) => String(fact).trim())
      .filter(Boolean)
      .slice(0, Math.max(0, options.maxProfileItems));
  const facts = [
    ...take(result?.profile?.static || []),
    ...take(result?.profile?.dynamic || []),
  ];
  const render = (body) => `<supermemory-context>
Recalled memory for this project (${options.projectName}). Every line marked ◪ comes from supermemory — when citing one, keep the mark and phrase it naturally. If you name the source, say "from supermemory" — never "from memory".
This project's memory container: ${options.containerTag}

${body}
</supermemory-context>`;
  const items = facts.map((fact, index) => ({
    before: index === 0 ? '[Memory Profile]\n' : '\n',
    prefix: `${index + 1}. ◪ `,
    text: fact,
    suffix: '',
  }));
  return formatBoundedItems(items, options.maxTokens, 'maxRecallTokens', render);
}

module.exports = {
  formatRecallContext,
  formatSessionContext,
  getRecallContainerTags,
  mergeProfileResults,
  resultText,
};
