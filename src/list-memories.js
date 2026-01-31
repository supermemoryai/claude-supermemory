const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10);

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

  try {
    const client = new SupermemoryClient(apiKey, containerTag);
    const result = await client.listMemories(containerTag, limit);
    const memories = result.memories || result || [];

    console.log(`## Memories for ${projectName} (${memories.length} results)\n`);

    for (const mem of memories) {
      const id = mem.id || 'unknown';
      const created = mem.createdAt || mem.created_at || '';
      const content = (mem.summary || mem.content || mem.text || '').substring(0, 150).replace(/\n/g, ' ');
      console.log(`${id}  (${created})`);
      console.log(`  ${content}${content.length >= 150 ? '...' : ''}`);
      console.log('');
    }
  } catch (err) {
    console.log(`Error listing memories: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
