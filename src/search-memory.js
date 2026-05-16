const { SupermemoryClient } = require('./lib/supermemory-client');
const {
  getProjectName,
  getContainerTag,
  getRepoContainerTag,
} = require('./lib/container-tag');
const { loadSettings, getApiKey, validateContainerTag } = require('./lib/settings');
const { formatSearchResults } = require('./lib/format-context');
const { getUserFriendlyError } = require('./lib/error-helpers');

function parseArgs(args) {
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

async function main() {
  const { containerType, query, containerTag } = parseArgs(process.argv.slice(2));

  if (!query || !query.trim()) {
    console.log(
      'No search query provided. Please specify what you want to search for.',
    );
    return;
  }

  const settings = loadSettings();

  let apiKey;
  try {
    apiKey = getApiKey(settings);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log(
      'Set SUPERMEMORY_CC_API_KEY environment variable to enable memory search.',
    );
    console.log('Get your key at: https://app.supermemory.ai');
    return;
  }

  const cwd = process.cwd();

  if (containerTag) {
    const validationError = validateContainerTag(containerTag, cwd);
    if (validationError) {
      console.log(validationError);
      process.exit(1);
    }
  }

  const projectName = getProjectName(cwd);
  const personalTag = getContainerTag(cwd);
  const repoTag = getRepoContainerTag(cwd);

  try {
    const client = new SupermemoryClient(apiKey, personalTag);

    console.log(`Project: ${projectName}\n`);

    if (containerType === 'custom' && containerTag) {
      const result = await client.search(query, containerTag, { limit: 10 });
      if (result.results?.length > 0) {
        console.log(
          formatSearchResults(query, result.results, `Container: ${containerTag}`),
        );
      } else {
        console.log(`No memories found in container '${containerTag}' for "${query}"`);
      }
    } else if (containerType === 'both') {
      const [personalResult, repoResult] = await Promise.all([
        client.search(query, personalTag, { limit: 5 }),
        client.search(query, repoTag, { limit: 5 }),
      ]);

      if (personalResult.results?.length > 0) {
        console.log(
          formatSearchResults(query, personalResult.results, 'Personal'),
        );
      }
      if (repoResult.results?.length > 0) {
        if (personalResult.results?.length > 0) console.log('');
        console.log(formatSearchResults(query, repoResult.results, 'Project'));
      }
      if (!personalResult.results?.length && !repoResult.results?.length) {
        console.log(`No memories found for "${query}"`);
      }
    } else {
      const tag = containerType === 'user' ? personalTag : repoTag;
      const label = containerType === 'user' ? 'Personal' : 'Project';
      const searchResult = await client.search(query, tag, { limit: 10 });
      console.log(formatSearchResults(query, searchResult.results, label));
    }
  } catch (err) {
    console.log(`Error searching memories: ${getUserFriendlyError(err)}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
