const { getProfile } = require('./lib/api');
const { getNamespace } = require('./lib/container-tag');
const { loadProjectConfig } = require('./lib/project-config');
const { loadCredentials, settleAuth } = require('./lib/auth');
const {
  getAuthToken,
  getBaseUrl,
  getApiVersion,
  routeDirectory,
} = require('./lib/settings');
const { getUserFriendlyError } = require('./lib/error-helpers');

async function main() {
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);
  const namespace = getNamespace(cwd);
  const baseUrl = getBaseUrl(cwd, projectConfig);
  const apiOrigin = new URL(baseUrl).origin;
  const apiVersion = getApiVersion(cwd, projectConfig);
  const saved = loadCredentials();
  const keySource = process.env.SUPERMEMORY_CC_API_KEY
    ? 'SUPERMEMORY_CC_API_KEY'
    : projectConfig?.apiKey
      ? 'project config'
      : saved?.type === 'oauth'
        ? 'oauth'
        : 'credentials.json';
  let apiKey;
  try {
    apiKey = await getAuthToken(cwd, projectConfig, 8000);
  } catch (error) {
    console.log(
      JSON.stringify({
        authenticated: false,
        ...(error.code === 'ORG_PAUSED'
          ? {
              paused: true,
              organization: error.route?.orgId ?? null,
              reason: error.message,
            }
          : {}),
        namespace,
        apiOrigin,
        apiVersion,
      }),
    );
    return;
  }
  const organization =
    keySource === 'oauth' ? routeDirectory(cwd).orgId : undefined;
  try {
    await getProfile(baseUrl, apiKey, namespace, undefined, {
      apiVersion,
      timeoutMs: 8000,
    });
    console.log(
      JSON.stringify({
        authenticated: true,
        keySource,
        organization,
        namespace,
        apiOrigin,
        apiVersion,
        httpStatus: 200,
      }),
    );
  } catch (err) {
    const httpStatus = err?.status ?? err?.statusCode ?? null;
    console.log(
      JSON.stringify({
        authenticated: httpStatus === 401 ? false : null,
        keySource,
        organization,
        namespace: err?.code === 'INVALID_NAMESPACE' ? null : namespace,
        apiOrigin,
        apiVersion,
        httpStatus,
        error:
          httpStatus === 404
            ? 'Endpoint responded; profile absent or route unsupported. Authentication is unknown.'
            : getUserFriendlyError(err),
      }),
    );
  }
}

main()
  .catch((err) => {
    console.log(JSON.stringify({ error: getUserFriendlyError(err) }));
  })
  .finally(settleAuth);
