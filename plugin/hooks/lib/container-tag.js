const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadProjectConfig } = require('./project-config');
const { getGitRoot } = require('./git-utils');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

const repoInfoCache = new Map();

function normalizeGitRemote(remoteUrl) {
  const raw = remoteUrl.trim();
  if (!raw) return null;

  let normalized;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'file:') {
        normalized = `file:${decodeURIComponent(parsed.pathname)}`;
      } else {
        normalized = `${parsed.hostname.toLowerCase()}${
          parsed.port ? `:${parsed.port}` : ''
        }/${parsed.pathname.replace(/^\/+/, '')}`;
      }
    } catch {
      normalized = raw;
    }
  } else {
    const scpStyle = raw.match(/^(?:[^@/]+@)?([^:]+):(.+)$/);
    normalized = scpStyle
      ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}`
      : `file:${path.resolve(raw)}`;
  }

  return normalized
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

function getGitRepoInfo(cwd) {
  if (repoInfoCache.has(cwd)) {
    return repoInfoCache.get(cwd);
  }
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const normalizedRemote = normalizeGitRemote(remoteUrl);
    const displayRemote = remoteUrl.replace(/\/+$/, '').replace(/\.git$/i, '');
    const separator = Math.max(
      displayRemote.lastIndexOf('/'),
      displayRemote.lastIndexOf(':'),
    );
    const name = displayRemote.slice(separator + 1) || null;
    const result = { name, normalizedRemote };
    repoInfoCache.set(cwd, result);
    return result;
  } catch {
    const result = { name: null, normalizedRemote: null };
    repoInfoCache.set(cwd, result);
    return result;
  }
}

function getGitRepoName(cwd) {
  return getGitRepoInfo(cwd).name;
}

function getProjectBasePath(cwd) {
  return getGitRoot(cwd) || path.resolve(cwd);
}

function sanitizeRepoName(name) {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (sanitized || 'unknown').slice(0, 95).replace(/_+$/g, '') || 'unknown';
}

function getProjectIdentity(cwd) {
  const basePath = getProjectBasePath(cwd);
  const { normalizedRemote } = getGitRepoInfo(basePath);
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === 'true';
  let localIdentity = basePath;
  try {
    localIdentity = fs.realpathSync.native(basePath);
  } catch {}
  return sha256(
    !isolateWorktrees && normalizedRemote
      ? normalizedRemote
      : `path:${localIdentity}`,
  );
}

function getGeneratedContainerTag(cwd) {
  const basePath = getProjectBasePath(cwd);
  const gitRepoName = getGitRepoName(basePath);
  const repoName = gitRepoName || path.basename(basePath) || 'unknown';
  const shortName = sanitizeRepoName(repoName).slice(0, 72).replace(/_+$/g, '');
  return `repo_${shortName || 'unknown'}__${getProjectIdentity(cwd)}`;
}

function getNamespace(cwd) {
  const projectConfig = loadProjectConfig(cwd);
  return (
    projectConfig?.namespace ||
    projectConfig?.repoContainerTag ||
    process.env.SUPERMEMORY_NAMESPACE ||
    process.env.SUPERMEMORY_REPO_TAG ||
    getGeneratedContainerTag(cwd)
  );
}

function getContainerTag(cwd) {
  return getNamespace(cwd);
}

function getProjectName(cwd) {
  const basePath = getProjectBasePath(cwd);
  return getGitRepoName(basePath) || path.basename(basePath) || 'unknown';
}

module.exports = {
  sha256,
  getGitRoot,
  normalizeGitRemote,
  getGitRepoName,
  getProjectBasePath,
  getProjectIdentity,
  getGeneratedContainerTag,
  getContainerTag,
  getNamespace,
  getProjectName,
  sanitizeRepoName,
};
