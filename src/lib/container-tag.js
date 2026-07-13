const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadProjectConfig } = require('./project-config');
const { getGitRoot } = require('./git-utils');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

const repoNameCache = new Map();

function getGitRepoName(cwd) {
  if (repoNameCache.has(cwd)) {
    return repoNameCache.get(cwd);
  }
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const normalized = remoteUrl.replace(/\/+$/, '').replace(/\.git$/i, '');
    const separator = Math.max(
      normalized.lastIndexOf('/'),
      normalized.lastIndexOf(':'),
    );
    const result = normalized.slice(separator + 1) || null;
    repoNameCache.set(cwd, result);
    return result;
  } catch {
    repoNameCache.set(cwd, null);
    return null;
  }
}

function getProjectBasePath(cwd) {
  return getGitRoot(cwd) || path.resolve(cwd);
}

function getGeneratedContainerTag(cwd) {
  return `user_project_${sha256(getProjectBasePath(cwd))}`;
}

function getContainerTag(cwd) {
  const projectConfig = loadProjectConfig(cwd);
  return (
    projectConfig?.personalContainerTag ||
    loadLegacyCodexConfig()?.userContainerTag ||
    getGeneratedContainerTag(cwd)
  );
}

function getLegacyContainerTag(cwd) {
  return `claudecode_project_${sha256(getProjectBasePath(cwd))}`;
}

function getLegacyCodexUserTag(cwd) {
  let identity = null;
  try {
    identity = execSync('git config user.email', {
      cwd: getProjectBasePath(cwd),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {}
  identity =
    identity || process.env.USER || process.env.USERNAME || os.hostname();
  return `codex_user_${sha256(identity)}`;
}

function getLegacyCodexProjectTag(cwd) {
  return `codex_project_${sha256(getProjectBasePath(cwd))}`;
}

function loadLegacyCodexConfig() {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'supermemory.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getLegacyCodexUserTags(cwd) {
  const config = loadLegacyCodexConfig();
  const defaultTag = getLegacyCodexUserTag(cwd);
  const suffix = defaultTag.slice('codex_user_'.length);
  return uniqueTags([
    config?.userContainerTag,
    `${config?.containerTagPrefix || 'codex'}_user_${suffix}`,
    defaultTag,
  ]);
}

function getLegacyCodexProjectTags(cwd) {
  const config = loadLegacyCodexConfig();
  const defaultTag = getLegacyCodexProjectTag(cwd);
  const suffix = defaultTag.slice('codex_project_'.length);
  return uniqueTags([
    config?.projectContainerTag,
    `${config?.containerTagPrefix || 'codex'}_project_${suffix}`,
    defaultTag,
  ]);
}

function sanitizeRepoName(name) {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (sanitized || 'unknown').slice(0, 95).replace(/_+$/g, '') || 'unknown';
}

function getGeneratedRepoContainerTag(cwd) {
  const basePath = getProjectBasePath(cwd);
  const gitRepoName = getGitRepoName(basePath);
  const repoName = gitRepoName || path.basename(basePath) || 'unknown';
  return `repo_${sanitizeRepoName(repoName)}`;
}

function getRepoContainerTag(cwd) {
  const projectConfig = loadProjectConfig(cwd);
  return (
    projectConfig?.repoContainerTag ||
    loadLegacyCodexConfig()?.projectContainerTag ||
    getGeneratedRepoContainerTag(cwd)
  );
}

function getProjectName(cwd) {
  const basePath = getProjectBasePath(cwd);
  const gitRepoName = getGitRepoName(basePath);
  return gitRepoName || path.basename(basePath) || 'unknown';
}

function uniqueTags(tags) {
  return [
    ...new Set(tags.filter((tag) => typeof tag === 'string' && tag.trim())),
  ];
}

function getPersonalReadTags(cwd) {
  return uniqueTags([
    getContainerTag(cwd),
    getGeneratedContainerTag(cwd),
    getLegacyContainerTag(cwd),
    ...getLegacyCodexUserTags(cwd),
  ]);
}

function getProjectReadTags(cwd) {
  return uniqueTags([
    getRepoContainerTag(cwd),
    getGeneratedRepoContainerTag(cwd),
    ...getLegacyCodexProjectTags(cwd),
  ]);
}

module.exports = {
  sha256,
  getGitRoot,
  getGitRepoName,
  getContainerTag,
  getGeneratedContainerTag,
  getLegacyContainerTag,
  getLegacyCodexUserTag,
  getLegacyCodexProjectTag,
  getRepoContainerTag,
  getGeneratedRepoContainerTag,
  getProjectName,
  getPersonalReadTags,
  getProjectReadTags,
  sanitizeRepoName,
};
