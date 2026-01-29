const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');

async function main() {
  const query = process.argv.slice(2).join(' ');

  if (!query || !query.trim()) {
    console.log('No search query provided. Please specify what you want to search for.');
    return;
  }

  const settings = loadSettings();

  let apiKey;
  try {
    apiKey = getApiKey(settings);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log('Set SUPERMEMORY_CC_API_KEY environment variable to enable memory search.');
    console.log('Get your key at: https://console.supermemory.ai');
    return;
  }

  const cwd = process.cwd();
  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new SupermemoryClient(apiKey, containerTag);
    const result = await client.getProfile(containerTag, query);

    console.log(`## Memory Search: "${query}"`);
    console.log(`Project: ${projectName}\n`);

    if (result.profile) {
      if (result.profile.static?.length > 0) {
        console.log('### User Preferences');
        result.profile.static.forEach(fact => console.log(`- ${fact}`));
        console.log('');
      }
      if (result.profile.dynamic?.length > 0) {
        console.log('### Recent Context');
        result.profile.dynamic.forEach(fact => console.log(`- ${fact}`));
        console.log('');
      }
    }

    if (result.searchResults?.results?.length > 0) {
      console.log('### Relevant Memories');
      result.searchResults.results.forEach((mem, i) => {
        const similarity = Math.round(mem.similarity * 100);
        const content = mem.memory || mem.content || '';
        console.log(`\n**Memory ${i + 1}** (${similarity}% match)`);
        if (mem.title) console.log(`*${mem.title}*`);
        console.log(content.slice(0, 500));
      });
    } else {
      const searchResult = await client.search(query, containerTag, { limit: 10 });
      if (searchResult.results?.length > 0) {
        console.log('### Relevant Memories');
        searchResult.results.forEach((mem, i) => {
          const similarity = Math.round(mem.similarity * 100);
          const content = mem.memory || mem.content || '';
          console.log(`\n**Memory ${i + 1}** (${similarity}% match)`);
          if (mem.title) console.log(`*${mem.title}*`);
          console.log(content.slice(0, 500));
        });
      } else {
        console.log('No memories found matching your query.');
        console.log('Memories are automatically saved as you work in this project.');
      }
    }

  } catch (err) {
    console.log(`Error searching memories: ${err.message}`);
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
