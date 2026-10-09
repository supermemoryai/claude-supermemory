const { getProfile } = require('./lib/api');
const { getNamespace } = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const { getApiKey, getBaseUrl, getApiVersion } = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');

async function main() {
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);
  const namespace = getNamespace(cwd);
  const baseUrl = getBaseUrl(cwd, projectConfig);
  const apiOrigin = new URL(baseUrl).origin;
  const apiVersion = getApiVersion(cwd, projectConfig);
  const keySource = process.env.SUPERMEMORY_CC_API_KEY
    ? 'SUPERMEMORY_CC_API_KEY'
    : projectConfig?.apiKey
      ? 'project config'
      : 'credentials.json';
  let apiKey;
  try {
    apiKey = getApiKey(cwd, projectConfig);
  } catch {
    console.log(
      JSON.stringify({
        authenticated: false,
        namespace,
        apiOrigin,
        apiVersion,
      }),
    );
    return;
  }
  try {
    await getProfile(baseUrl, apiKey, namespace, undefined, {
      apiVersion,
      timeoutMs: 8000,
    });
    console.log(
      JSON.stringify({
        authenticated: true,
        keySource,
        namespace,
        apiOrigin,
        apiVersion,
        httpStatus: 200,
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        keySource,
        namespace,
        apiOrigin,
        apiVersion,
        httpStatus: err?.status ?? err?.statusCode ?? null,
        error: getUserFriendlyError(err),
      }),
    );
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ error: getUserFriendlyError(err) }));
});
