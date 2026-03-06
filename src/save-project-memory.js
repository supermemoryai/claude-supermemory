const {
  SupermemoryClient,
  REPO_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
const { getRepoContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey } = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');

async function main() {
  const content = process.argv.slice(2).join(' ');

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node save-project-memory.cjs "content to save"',
    );
    return;
  }

  const settings = loadSettings();

  let apiKey;
  try {
    apiKey = getApiKey(settings);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log('Set SUPERMEMORY_CC_API_KEY environment variable.');
    return;
  }

  const cwd = process.cwd();
  const containerTag = getRepoContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new SupermemoryClient(apiKey, containerTag);
    const result = await client.addMemory(
      content,
      containerTag,
      {
        type: 'project-knowledge',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
      { entityContext: REPO_ENTITY_CONTEXT },
    );

    console.log(`Project knowledge saved: ${projectName}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving: ${getUserFriendlyError(err)}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
