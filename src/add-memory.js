const {
  SupermemoryClient,
  PERSONAL_ENTITY_CONTEXT,
} = require('./lib/supermemory-client');
const { getContainerTag, getProjectName } = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const { loadSettings, getApiKey, getBaseUrl } = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');

async function main() {
  const content = process.argv.slice(2).join(' ');

  if (!content || !content.trim()) {
    console.log(
      'No content provided. Usage: node add-memory.cjs "content to save"',
    );
    return;
  }

  const settings = loadSettings();
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);

  let apiKey;
  try {
    apiKey = getApiKey(settings, cwd, projectConfig);
  } catch {
    console.log('Supermemory API key not configured.');
    console.log('Set SUPERMEMORY_CC_API_KEY environment variable.');
    return;
  }

  const containerTag = getContainerTag(cwd);
  const projectName = getProjectName(cwd);

  try {
    const baseUrl = getBaseUrl(cwd, projectConfig);
    const client = new SupermemoryClient(apiKey, containerTag, { baseUrl });
    const result = await client.addMemory(
      content,
      containerTag,
      {
        type: 'manual',
        project: projectName,
        sm_scope: 'personal',
        sm_capture_mode: 'explicit',
        timestamp: new Date().toISOString(),
      },
      { entityContext: PERSONAL_ENTITY_CONTEXT },
    );

    console.log(`Memory saved to project: ${projectName}`);
    console.log(`ID: ${result.id}`);
  } catch (err) {
    console.log(`Error saving memory: ${getUserFriendlyError(err)}`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
