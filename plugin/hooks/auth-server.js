// Detached OAuth login started by the SessionStart hook; see startBackgroundAuth.
const { AUTH_WAIT_MS, getOAuthConfig, startAuthFlow } = require('./lib/auth');

const [baseUrl, mcpUrl] = process.argv.slice(2);

startAuthFlow(getOAuthConfig(baseUrl, mcpUrl), {
  timeoutMs: AUTH_WAIT_MS,
  background: true,
}).then(
  () => process.exit(0),
  () => process.exit(1),
);
