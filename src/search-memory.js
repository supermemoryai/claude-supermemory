const { SupermemoryClient } = require('./lib/supermemory-client');
const { loadCredentials } = require('./lib/auth');
const { formatSearchResults } = require('./lib/format-context');

async function searchMemory(query, containerTag, options = {}) {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error('Not authenticated. Please run login.');
  }

  const client = new SupermemoryClient(credentials.apiKey, containerTag);

  try {
    // Search personal memories
    const personalResult = await client.search(query, containerTag, {
      ...options,
      searchMode: 'hybrid',
    });

    // Search repo memories
    const repoResult = await client.search(query, 'repo-context', {
      ...options,
      searchMode: 'hybrid',
    });

    let output = '';

    if (personalResult.results?.length > 0 || repoResult.results?.length > 0) {
      if (personalResult.results?.length > 0) {
        console.log(
          formatSearchResults(query, personalResult.results, 'Personal'),
        );
      }
      if (repoResult.results?.length > 0) {
        console.log(formatSearchResults(query, repoResult.results, 'Repo'));
      }
    } else {
      output = 'No memories found for query: ' + query;
      console.log(output);
    }

    return {
      personal: personalResult.results,
      repo: repoResult.results,
    };
  } catch (error) {
    console.error('Search failed:', error.message);
    throw error;
  }
}

module.exports = { searchMemory };
