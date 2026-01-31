const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');

async function main() {
  const memoryIds = process.argv.slice(2);

  if (memoryIds.length === 0) {
    console.log('Usage: node delete-memory.cjs <memory_id> [memory_id2] ...');
    console.log('  Pass "all" to delete ALL memories for this project.');
    return;
  }

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

  try {
    const client = new SupermemoryClient(apiKey, containerTag);

    if (memoryIds[0] === 'all') {
      const result = await client.listMemories(containerTag, 200);
      const memories = result.memories || result || [];
      console.log(`Deleting all ${memories.length} memories...`);
      let deleted = 0;
      for (const mem of memories) {
        try {
          await client.deleteMemory(mem.id);
          deleted++;
        } catch (err) {
          console.log(`  Failed to delete ${mem.id}: ${err.message}`);
        }
      }
      console.log(`Deleted ${deleted}/${memories.length} memories.`);
    } else {
      for (const id of memoryIds) {
        try {
          await client.deleteMemory(id);
          console.log(`Deleted: ${id}`);
        } catch (err) {
          console.log(`Failed to delete ${id}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
