const fs = require('node:fs');
const os = require('node:os');
const { CREDENTIALS_FILE } = require('./lib/auth');
const { SETTINGS_FILE } = require('./lib/settings');
const {
  getProjectName,
  getContainerTag,
  getRepoContainerTag,
  getPersonalReadTags,
  getProjectReadTags,
} = require('./lib/container-tag');
const { getConfigPath } = require('./lib/project-config');

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

function main() {
  const cwd = process.cwd();
  const projectName = getProjectName(cwd);
  const auth = resolveApiKey(cwd);
  const statusLabel = auth.apiKey?.startsWith('sm_')
    ? 'connected'
    : 'not authenticated';

  console.log(`Supermemory is ${statusLabel}.`);
  console.log('');
  console.log('Status:');
  console.log(`- Project: ${projectName}`);
  console.log(`- Personal writes: ${getContainerTag(cwd)}`);
  console.log(`- Project writes: ${getRepoContainerTag(cwd)}`);
  console.log(`- Personal reads: ${getPersonalReadTags(cwd).join(', ')}`);
  console.log(`- Project reads: ${getProjectReadTags(cwd).join(', ')}`);
  console.log(`- API key source: ${displayPath(auth.source)}`);
  console.log(`- API key: ${maskApiKey(auth.apiKey)}`);
}

main();
