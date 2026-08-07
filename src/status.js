const fs = require('node:fs');
const os = require('node:os');
const { CREDENTIALS_FILE } = require('./lib/auth');
const { SETTINGS_FILE, getBaseUrl } = require('./lib/settings');
const {
  getProjectName,
  getContainerTag,
  getAllReadTags,
} = require('./lib/container-tag');
const { getConfigPath, loadProjectConfig } = require('./lib/project-config');
const { SupermemoryClient } = require('./lib/supermemory-client');
const { getUserFriendlyError } = require('./lib/error-helpers');

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, data: null, error: null };
    }
    return {
      exists: true,
      data: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
      error: null,
    };
  } catch (err) {
    return {
      exists: true,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function maskApiKey(apiKey) {
  if (!apiKey) return 'not set';
  if (apiKey.length <= 12) return `${apiKey.slice(0, 3)}... masked`;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)} masked`;
}

function displayPath(filePath) {
  if (!filePath) return 'not found';
  const home = os.homedir();
  return filePath.startsWith(`${home}/`)
    ? `~/${filePath.slice(home.length + 1)}`
    : filePath;
}

function resolveApiKey(cwd) {
  const globalSettings = readJson(SETTINGS_FILE);
  const projectConfigPath = getConfigPath(cwd);
  const projectConfig = readJson(projectConfigPath);
  const credentials = readJson(CREDENTIALS_FILE);

  const envKey = stringValue(process.env.SUPERMEMORY_CC_API_KEY);
  if (envKey) {
    return {
      apiKey: envKey,
      source: 'SUPERMEMORY_CC_API_KEY environment variable',
    };
  }

  const globalSettingsKey = stringValue(globalSettings.data?.apiKey);
  if (globalSettingsKey) {
    return {
      apiKey: globalSettingsKey,
      source: SETTINGS_FILE,
    };
  }

  const projectConfigKey = stringValue(projectConfig.data?.apiKey);
  if (projectConfigKey) {
    return {
      apiKey: projectConfigKey,
      source: projectConfigPath,
    };
  }

  const credentialsKey = stringValue(credentials.data?.apiKey);
  return {
    apiKey: credentialsKey,
    source: credentialsKey ? CREDENTIALS_FILE : null,
  };
}

async function checkConnection(apiKey, containerTag, baseUrl) {
  try {
    const client = new SupermemoryClient(apiKey, containerTag, { baseUrl });
    // A minimal, read-only call: proves the key and baseUrl actually reach
    // a live Supermemory backend, rather than just matching a string prefix.
    await client.search('supermemory-status-check', containerTag, {
      limit: 1,
    });
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: getUserFriendlyError(err) };
  }
}

async function main() {
  const cwd = process.cwd();
  const projectName = getProjectName(cwd);
  const auth = resolveApiKey(cwd);
  const containerTag = getContainerTag(cwd);

  let statusLabel = 'not authenticated';
  let connectionDetail = null;

  if (auth.apiKey?.startsWith('sm_')) {
    const projectConfig = loadProjectConfig(cwd);
    const baseUrl = getBaseUrl(cwd, projectConfig);
    const probe = await checkConnection(auth.apiKey, containerTag, baseUrl);
    statusLabel = probe.connected ? 'connected' : 'unreachable';
    if (!probe.connected) connectionDetail = probe.reason;
  }

  console.log(`Supermemory is ${statusLabel}.`);
  if (connectionDetail) console.log(`  (${connectionDetail})`);
  console.log('');
  console.log('Status:');
  console.log(`- Project: ${projectName}`);
  console.log(`- Project container: ${containerTag}`);
  console.log(`- Reads (including legacy): ${getAllReadTags(cwd).join(', ')}`);
  console.log(`- API key source: ${displayPath(auth.source)}`);
  console.log(`- API key: ${maskApiKey(auth.apiKey)}`);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
