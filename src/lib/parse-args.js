// Parses --container <tag> from argv; remaining args become the content.
function parseMemoryArgs(args) {
  let containerTag = null;
  const contentParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--container' && i + 1 < args.length) {
      containerTag = args[++i];
    } else {
      contentParts.push(args[i]);
    }
  }

  return { content: contentParts.join(' '), containerTag };
}

// Parses --user/--repo/--both/--container <tag> from argv; remaining args become the query.
function parseSearchArgs(args) {
  let containerType = 'both';
  let containerTag = null;
  const queryParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user') {
      containerType = 'user';
    } else if (args[i] === '--repo') {
      containerType = 'repo';
    } else if (args[i] === '--both') {
      containerType = 'both';
    } else if (args[i] === '--container' && i + 1 < args.length) {
      containerTag = args[++i];
      containerType = 'custom';
    } else {
      queryParts.push(args[i]);
    }
  }

  return { containerType, query: queryParts.join(' '), containerTag };
}

module.exports = { parseMemoryArgs, parseSearchArgs };
