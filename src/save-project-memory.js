const {
  LocalMemoryClient,
  REPO_ENTITY_CONTEXT,
} = require('./lib/local-memory-client');
const { getRepoContainerTag, getProjectName } = require('./lib/container-tag');

async function main() {
  const content = process.argv.slice(2).join(' ');

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node save-project-memory.cjs "content to save"',
    );
    return;
  }

  const cwd = process.cwd();
  const containerTag = getRepoContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new LocalMemoryClient(containerTag);
    const result = await client.addMemory(
      content,
      containerTag,
      {
        type: 'project-knowledge',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
    );

    console.log(`Project knowledge saved: ${projectName}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
