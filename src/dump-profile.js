const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');

async function main() {
  const settings = loadSettings();
  let apiKey;
  try {
    apiKey = getApiKey(settings);
  } catch {
    console.log('Supermemory API key not configured.');
    return;
  }

  const cwd = process.cwd();
  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  const client = new SupermemoryClient(apiKey, containerTag);
  const result = await client.getProfile(containerTag);

  const staticItems = result.profile?.static || [];
  const dynamicItems = result.profile?.dynamic || [];

  console.log(`## Profile for ${projectName}`);
  console.log(`Static items: ${staticItems.length}`);
  console.log(`Dynamic items: ${dynamicItems.length}`);
  console.log(`\n### Static (first 10):`);
  staticItems.slice(0, 10).forEach((item, i) => {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    console.log(`${i + 1}. ${text.substring(0, 120)}`);
  });
  console.log(`\n### Dynamic (first 10):`);
  dynamicItems.slice(0, 10).forEach((item, i) => {
    const text = typeof item === 'string' ? item : JSON.stringify(item);
    console.log(`${i + 1}. ${text.substring(0, 120)}`);
  });

  // Also try listing memories with higher limit
  const memResult = await client.listMemories(containerTag, 200);
  const memories = memResult.memories || [];
  console.log(`\n### Discrete memories: ${memories.length}`);
  memories.forEach((mem, i) => {
    const summary = (mem.summary || '').substring(0, 100).replace(/\n/g, ' ');
    console.log(`${i + 1}. ${mem.id} — ${summary || '(empty)'}`);
  });
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
