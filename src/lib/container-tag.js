const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const { loadProjectConfig } = require('./project-config');
const { getGitRoot } = require('./git-utils');
const { loadGlobalSettings } = require('./global-settings');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function getGitRepoName(cwd) {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remoteUrl.match(/[/:]([^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getContainerTag(cwd) {
  // 1. Check project config
  const projectConfig = loadProjectConfig(cwd);
  if (projectConfig?.personalContainerTag) {
    return projectConfig.personalContainerTag;
  }

  // 2. Check environment variable
  if (process.env.SUPERMEMORY_CONTAINER_TAG) {
    return process.env.SUPERMEMORY_CONTAINER_TAG;
  }

  // 3. Check global settings
  const globalSettings = loadGlobalSettings();
  if (globalSettings?.personalContainerTag) {
    return globalSettings.personalContainerTag;
  }

  // 4. Fallback to git-path hash
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  return `claudecode_project_${sha256(basePath)}`;
}

function sanitizeRepoName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function getRepoContainerTag(cwd) {
  const projectConfig = loadProjectConfig(cwd);
  if (projectConfig?.repoContainerTag) {
    return projectConfig.repoContainerTag;
  }
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;

  const gitRepoName = getGitRepoName(basePath);
  const repoName = gitRepoName || basePath.split('/').pop() || 'unknown';

  return `repo_${sanitizeRepoName(repoName)}`;
}

function getProjectName(cwd) {
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  const gitRepoName = getGitRepoName(basePath);
  return gitRepoName || basePath.split('/').pop() || 'unknown';
}

module.exports = {
  sha256,
  getGitRoot,
  getGitRepoName,
  getContainerTag,
  getRepoContainerTag,
  getProjectName,
};
