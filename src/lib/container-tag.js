const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const { loadSettings } = require('./settings');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function getGitRoot(cwd) {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return gitRoot || null;
  } catch {
    return null;
  }
}

function getContainerTag(cwd) {
  // Check for configured container tag (env var or settings file)
  const settings = loadSettings();
  if (settings.containerTag) {
    // Validate the configured tag
    if (typeof settings.containerTag !== 'string' || settings.containerTag.length === 0) {
      console.warn('Supermemory: containerTag is invalid, falling back to auto-derived');
    } else if (settings.containerTag.length > 100) {
      console.warn('Supermemory: containerTag exceeds 100 characters, falling back to auto-derived');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(settings.containerTag)) {
      console.warn('Supermemory: containerTag contains invalid characters, falling back to auto-derived');
    } else if (/^[-_]|[-_]$/.test(settings.containerTag)) {
      console.warn('Supermemory: containerTag must not start or end with - or _, falling back to auto-derived');
    } else {
      return settings.containerTag;
    }
  }

  // Fall back to auto-derived tag
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  return `claudecode_project_${sha256(basePath)}`;
}

function getProjectName(cwd) {
  const gitRoot = getGitRoot(cwd);
  const basePath = gitRoot || cwd;
  return basePath.split('/').pop() || 'unknown';
}

function getUserContainerTag() {
  try {
    const email = execSync('git config user.email', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (email) return `claudecode_user_${sha256(email)}`;
  } catch {}
  const username = process.env.USER || process.env.USERNAME || 'anonymous';
  return `claudecode_user_${sha256(username)}`;
}

module.exports = {
  sha256,
  getGitRoot,
  getContainerTag,
  getProjectName,
  getUserContainerTag,
};
