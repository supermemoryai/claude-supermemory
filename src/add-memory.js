const {
  SupermemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const {
  loadSettings,
  getApiKey,
  validateContainerTag,
} = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');
const { parseMemoryArgs } = require('./lib/parse-args');

async function main() {
  const { content, containerTag } = parseMemoryArgs(process.argv.slice(2));

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node add-memory.cjs [--container <tag>] "content to save"',
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

  const effectiveTag = containerTag || getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const client = new SupermemoryClient(apiKey, effectiveTag);
    const result = await client.addMemory(
      content,
      effectiveTag,
      {
        type: 'manual',
        project: projectName,
        timestamp: new Date().toISOString(),
      },
      { entityContext: PERSONAL_ENTITY_CONTEXT },
    );

    const tagLabel = containerTag
      ? `container '${containerTag}'`
      : `project: ${projectName}`;
    console.log(`Memory saved to ${tagLabel}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving memory: ${getUserFriendlyError(err)}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
