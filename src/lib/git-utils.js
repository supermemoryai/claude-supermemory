const { execSync } = require('node:child_process');
const path = require('node:path');

function getGitRoot(cwd) {
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === 'true';

  try {
    if (isolateWorktrees) {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return gitRoot || null;
    }

    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (gitCommonDir === '.git') {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return gitRoot || null;
    }

    const resolved = path.resolve(cwd, gitCommonDir);

    if (
      path.basename(resolved) === '.git' &&
      !resolved.includes(`${path.sep}.git${path.sep}`)
    ) {
      return path.dirname(resolved);
    }

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

module.exports = { getGitRoot };
