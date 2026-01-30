const { SupermemoryClient } = require('./lib/supermemory-client');
const { getContainerTag } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');

async function main() {
  const memoryId = process.argv[2];
  if (!memoryId) {
    console.log('Usage: node get-memory.cjs <memory_id>');
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
  const client = new SupermemoryClient(apiKey, containerTag);

  try {
    // Use the SDK to get a single memory
    const result = await client.client.memories.get(memoryId);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
