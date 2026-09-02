const { getContainerTag } = require('./lib/container-tag');
const { getProfile } = require('./lib/api');
const { loadProjectConfig } = require('./lib/project-config');
const { getApiKey, getBaseUrl } = require('./lib/settings');

async function main() {
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);
  const apiKey = getApiKey(cwd, projectConfig);
  const baseUrl = getBaseUrl(cwd, projectConfig, apiKey);
  const containerTag = getContainerTag(cwd);
  const keySource = process.env.SUPERMEMORY_CC_API_KEY
    ? 'SUPERMEMORY_CC_API_KEY'
    : projectConfig?.apiKey
      ? 'project config'
      : '~/.supermemory-claude/credentials.json';
  let httpStatus;
  try {
    await getProfile(baseUrl, apiKey, containerTag, 'connectivity probe', {
      timeoutMs: 8000,
    });
    httpStatus = 200;
  } catch (error) {
    if (!Number.isInteger(error.status)) throw error;
    httpStatus = error.status;
  }
  console.log(
    JSON.stringify({
      authenticated:
        httpStatus === 200
          ? true
          : [401, 403].includes(httpStatus)
            ? false
            : null,
      keySource,
      baseUrl,
      containerTag,
      httpStatus,
    }),
  );
}

main().catch((error) => {
  console.error(
    error.name === 'AbortError' || error.name === 'TimeoutError'
      ? 'API probe timed out'
      : error.cause?.message || error.message,
  );
  process.exit(1);
});
