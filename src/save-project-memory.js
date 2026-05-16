const {
  SupermemoryClient,
  REPO_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
const { getRepoContainerTag, getProjectName } = require('./lib/container-tag');
const { loadSettings, getApiKey, validateContainerTag } = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');

function parseArgs(args) {
  let containerTag = null;
  const contentParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--container' && i + 1 < args.length) {
      containerTag = args[++i];
    } else {
      contentParts.push(args[i]);
    }
  }

  return { content: contentParts.join(' '), containerTag };
}

async function main() {
  const { content, containerTag } = parseArgs(process.argv.slice(2));

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node save-project-memory.cjs [--container <tag>] "content to save"',
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

  if (containerTag) {
    const validationError = validateContainerTag(containerTag, cwd);
    if (validationError) {
      console.log(validationError);
      process.exit(1);
    }
  }

  const effectiveTag = containerTag || getRepoContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new SupermemoryClient(apiKey, effectiveTag);
    const result = await client.addMemory(
      content,
      effectiveTag,
      {
        type: 'project-knowledge',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
      { entityContext: REPO_ENTITY_CONTEXT },
    );

    const tagLabel = containerTag
      ? `container '${containerTag}'`
      : `project: ${projectName}`;
    console.log(`Project knowledge saved to ${tagLabel}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving: ${getUserFriendlyError(err)}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
