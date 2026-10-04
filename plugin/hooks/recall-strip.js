function returnedFacts(contexts, tag) {
  const facts = [];
  for (const context of contexts || []) {
    if (typeof context !== 'string') continue;
    const block = context.match(
      new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`),
    )?.[1];
    if (!block) continue;
    let current = -1;
    for (const line of block.split('\n')) {
      if (
        line.startsWith('## User Profile') ||
        line.startsWith('## Recent Context')
      ) {
        current = -1;
        continue;
      }
      const text = line.match(/^- ◪ (.+)$/)?.[1];
      if (text) {
        current = facts.length;
        facts.push(text);
      } else if (tag === 'supermemory-context' && current >= 0) {
        facts[current] += `\n${line}`;
      }
    }
  }
  return facts.map((fact) => fact.trimEnd());
}

const headlines = [
  (count, narrow) =>
    narrow
      ? `clarified ${count}`
      : `supermemory clarified ${count} ${count === 1 ? 'thing' : 'things'}`,
  (count, narrow) =>
    narrow
      ? `surfaced ${count}`
      : `supermemory surfaced ${count} ${count === 1 ? 'detail' : 'details'}`,
  (count, narrow) =>
    narrow
      ? `${count} brought back`
      : `supermemory brought back ${count} ${count === 1 ? 'memory' : 'memories'}`,
  (count, narrow) =>
    narrow
      ? `found ${count}`
      : `supermemory found ${count} ${count === 1 ? 'useful detail' : 'useful details'}`,
  (count, narrow) =>
    narrow
      ? `uncovered ${count}`
      : `supermemory uncovered ${count} ${count === 1 ? 'detail' : 'details'}`,
  (count, narrow) =>
    narrow
      ? `remembers ${count}`
      : `supermemory remembered ${count} ${count === 1 ? 'thing' : 'things'}`,
];

export function register(on) {
  let facts = [];
  let expanded = false;
  let active = 0;
  let headlineIndex = Math.floor(Math.random() * headlines.length) - 1;

  on('classic.SessionStart', async ($, e, next) => {
    facts = [];
    expanded = false;
    active = 0;
    try {
      const result = await next(e);
      facts = returnedFacts(result.additionalContext, 'supermemory-context');
      if (facts.length) headlineIndex = (headlineIndex + 1) % headlines.length;
      return result;
    } finally {
      $.ui.invalidate('ui.render');
    }
  });

  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      facts = [];
      expanded = false;
      active = 0;
      const result = await next(e);
      facts = returnedFacts(result.additionalContext, 'supermemory-recall');
      if (facts.length) headlineIndex = (headlineIndex + 1) % headlines.length;
      return result;
    } finally {
      $.ui.invalidate('ui.render');
    }
  });

  on(
    'ui.render',
    { component: 'AbovePrompt', surface: 'terminal' },
    async ($, e, next) => {
      const original = await next(e);
      if (e.props.hasSurvey || facts.length === 0) return original;

      const { Box, Text, Button } = $.ui.resolve(e);
      const width = Math.min(
        e.props.bodyColumns,
        Math.max(1, Math.min(64, e.props.bodyColumns - 4)),
      );
      const label = `◪ ${headlines[headlineIndex](facts.length, e.props.bodyColumns < 32)}`;

      return Box({
        flexDirection: 'column',
        children: [
          original,
          Button({
            key: 'recall-details',
            label: `${label} ${expanded ? '▴' : '▾'}`,
            plain: true,
            dimColor: true,
            onPress: () => {
              expanded = !expanded;
              if (expanded) active = 0;
              $.ui.invalidate('ui.render');
            },
          }),
          expanded
            ? Box({
                paddingX: 1,
                width,
                flexDirection: 'column',
                children: [
                  Text({ wrap: 'wrap', children: facts[active] }),
                  facts.length > 1
                    ? Box({
                        flexDirection: 'row',
                        children: [
                          Button({
                            key: 'recall-previous',
                            label: '‹',
                            plain: true,
                            dimColor: true,
                            onPress: () => {
                              active =
                                (active - 1 + facts.length) % facts.length;
                              $.ui.invalidate('ui.render');
                            },
                          }),
                          Text({
                            dimColor: true,
                            children: ` ${active + 1}/${facts.length} `,
                          }),
                          Button({
                            key: 'recall-next',
                            label: '›',
                            plain: true,
                            dimColor: true,
                            onPress: () => {
                              active = (active + 1) % facts.length;
                              $.ui.invalidate('ui.render');
                            },
                          }),
                        ],
                      })
                    : null,
                ],
              })
            : null,
        ],
      });
    },
  );
}
