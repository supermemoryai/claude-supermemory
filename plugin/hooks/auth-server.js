// Detached OAuth login started by the SessionStart hook; see startBackgroundAuth.
const { AUTH_WAIT_MS, getOAuthConfig, startAuthFlow } = require('./lib/auth');
const {
  appendProjectRule,
  planRepoBinding,
} = require('./vendor/agent-config.cjs');

const [baseUrl, mcpUrl, bindingArg] = process.argv.slice(2);

// The hook's directory and how it was routed before this login. A repository
// that wasn't routed yet keeps the org picked on the consent screen.
function bindRepository(orgId) {
  if (!bindingArg) return null;
  const { cwd, before } = JSON.parse(bindingArg);
  const rule = planRepoBinding(cwd, before, orgId);
  return rule && appendProjectRule(rule) ? rule.match.repo : null;
}

startAuthFlow(getOAuthConfig(baseUrl, mcpUrl), {
  timeoutMs: AUTH_WAIT_MS,
  background: true,
  onLogin: bindRepository,
}).then(
  () => process.exit(0),
  () => process.exit(1),
);
