const { SupermemoryClient } = require('./lib/supermemory-client');
const {
  getProjectName,
  getPersonalReadTags,
  getProjectReadTags,
} = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const { loadSettings, getApiKey, getBaseUrl } = require('./lib/settings');
const { formatSearchResults } = require('./lib/format-context');
const { getUserFriendlyError } = require('./lib/error-helpers');

function parseArgs(args) {
  let containerType = 'both';
  const queryParts = [];

  for (const arg of args) {
    if (arg === '--user') {
      containerType = 'user';
    } else if (arg === '--repo') {
      containerType = 'repo';
    } else if (arg === '--both') {
      containerType = 'both';
    } else {
      queryParts.push(arg);
    }
  }

  return { containerType, query: queryParts.join(' ') };
}

async function main() {
  const { containerType, query } = parseArgs(process.argv.slice(2));

  if (!query || !query.trim()) {
    console.log(
      'No search query provided. Please specify what you want to search for.',
    );
    return;
  }

  const settings = loadSettings();
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);

  let apiKey;
  try {
    apiKey = getApiKey(settings, cwd, projectConfig);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log(
      'Set SUPERMEMORY_CC_API_KEY environment variable to enable memory search.',
    );
    console.log('Get your key at: https://app.supermemory.ai');
    return;
  }

  const projectName = getProjectName(cwd);
  const personalTags = getPersonalReadTags(cwd);
  const repoTags = getProjectReadTags(cwd);

  try {
    const baseUrl = getBaseUrl(cwd, projectConfig);
    const client = new SupermemoryClient(apiKey, personalTags[0], { baseUrl });

    console.log(`Project: ${projectName}\n`);

    if (containerType === 'both') {
      const [personalResult, repoResult] = await Promise.all([
        client.searchMany(query, personalTags, { limit: 5 }),
        client.searchMany(query, repoTags, { limit: 5 }),
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
      const tags = containerType === 'user' ? personalTags : repoTags;
      const label = containerType === 'user' ? 'Personal' : 'Project';
      const searchResult = await client.searchMany(query, tags, { limit: 10 });
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
