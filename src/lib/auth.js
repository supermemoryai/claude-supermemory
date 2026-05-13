// Compat shim — delegates to oauth-client.js.

const {
  CLIENT_ID,
  CREDENTIALS_FILE,
  loadCredentials,
  clearCredentials,
  startOAuthFlow,
  getAccessToken,
  revoke,
} = require('./oauth-client');

const apiUrl = () =>
  (process.env.SUPERMEMORY_API_URL || 'https://api.supermemory.ai').replace(
    /\/+$/,
    '',
  );

async function startAuthFlow(opts) {
  const result = await startOAuthFlow(opts);
  return result.accessToken;
}

module.exports = {
  CLIENT_ID,
  CREDENTIALS_FILE,
  get AUTH_BASE_URL() {
    return `${apiUrl()}/api/auth/oauth2/authorize`;
  },
  loadCredentials,
  clearCredentials,
  startAuthFlow,
  startOAuthFlow,
  getAccessToken,
  revoke,
};
