#!/usr/bin/env node
const { getSession } = require('./lib/api');
const {
  CREDENTIALS_FILE,
  saveCredentials,
  startAuthFlow,
} = require('./lib/auth');
const { loadProjectConfig } = require('./lib/project-config');
const { getBaseUrl } = require('./lib/settings');

const VERIFY_TIMEOUT_MS = 8000;

function getOrganization(session) {
  const org = session?.org;
  if (!org || typeof org !== 'object') {
    throw new Error(
      'The new key was accepted, but Supermemory did not return an organization.',
    );
  }

  const id = typeof org.id === 'string' ? org.id.trim() : '';
  const name = typeof org.name === 'string' ? org.name.trim() : '';
  const slug = typeof org.slug === 'string' ? org.slug.trim() : '';
  if (!id || (!name && !slug)) {
    throw new Error(
      'The new key was accepted, but its organization details were incomplete.',
    );
  }

  return { id, name: name || slug, slug };
}

function getOverrideWarnings(env, projectConfig) {
  const warnings = [];
  if (env.SUPERMEMORY_CC_API_KEY) {
    warnings.push(
      'SUPERMEMORY_CC_API_KEY is set and overrides the saved credential. Unset it to use the organization selected here.',
    );
  }
  if (
    typeof projectConfig?.apiKey === 'string' &&
    projectConfig.apiKey
  ) {
    warnings.push(
      'This project has an apiKey in .claude/.supermemory-claude/config.json, which overrides the saved credential. Remove that field to use the organization selected here.',
    );
  }
  return warnings;
}

async function switchOrganization(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const projectConfig =
    options.projectConfig === undefined
      ? loadProjectConfig(cwd)
      : options.projectConfig;
  const baseUrl = options.baseUrl || getBaseUrl(cwd, projectConfig);
  const authenticate =
    options.authenticate ||
    (() =>
      startAuthFlow({
        persist: false,
        mode: 'switch_organization',
      }));
  const verify =
    options.verify ||
    ((url, apiKey) =>
      getSession(url, apiKey, {
        timeoutMs: VERIFY_TIMEOUT_MS,
        fetch: options.fetch,
      }));
  const persist = options.persist || saveCredentials;

  const apiKey = await authenticate();
  const session = await verify(baseUrl, apiKey);
  const organization = getOrganization(session);

  // Authentication and verification are deliberately complete before this
  // write, so a cancelled browser flow or rejected key leaves the old key in
  // place.
  persist(apiKey);

  return {
    organization,
    warnings: getOverrideWarnings(env, projectConfig),
  };
}

async function main() {
  console.log(
    'Opening Supermemory in your browser to choose an organization...',
  );

  try {
    const { organization, warnings } = await switchOrganization();
    console.log(
      `Connected to ${organization.name} (organization ${organization.id}).`,
    );
    console.log(`Saved the verified credential to ${CREDENTIALS_FILE}.`);
    for (const warning of warnings) console.warn(`Warning: ${warning}`);
    console.log(
      'Run /reload-plugins or restart Claude Code now. The running Supermemory MCP proxy keeps the key it loaded at startup.',
    );
  } catch (error) {
    const message =
      error?.message === 'AUTH_TIMEOUT'
        ? 'Organization selection timed out.'
        : `Organization switch failed: ${error?.message || 'Unknown error'}`;
    console.error(`${message} Any previously saved credentials were kept.`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  VERIFY_TIMEOUT_MS,
  getOrganization,
  getOverrideWarnings,
  switchOrganization,
};
