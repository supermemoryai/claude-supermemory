const { getContainerTag } = require('./lib/container-tag');
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${baseUrl}/v4/profile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'x-sm-source': 'claude-code',
      },
      body: JSON.stringify({ containerTag, q: 'connectivity probe' }),
      signal: controller.signal,
    });
    console.log(JSON.stringify({
      authenticated: response.status !== 401 && response.status !== 403,
      keySource,
      baseUrl,
      containerTag,
      httpStatus: response.status,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(
    error.name === 'AbortError'
      ? 'API probe timed out'
      : error.cause?.message || error.message,
  );
  process.exit(1);
});
