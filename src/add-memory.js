const {
  LocalMemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/local-memory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');

async function main() {
  const content = process.argv.slice(2).join(' ');

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node add-memory.cjs "content to save"',
    );
    return;
  }

  const cwd = process.cwd();
  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new LocalMemoryClient(containerTag);
    const result = await client.addMemory(
      content,
      containerTag,
      {
        type: 'manual',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
    );

    console.log(`Memory saved to project: ${projectName}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving memory: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
