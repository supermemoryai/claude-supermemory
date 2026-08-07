import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  mergeProfileResponses,
  mergeSearchResponses,
} = require('../src/lib/result-merge.js');
const {
  formatSearchResults,
  formatContext,
} = require('../src/lib/format-context.js');

function hash16(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function makeRepo(t, name = 'Example Project') {
  const root = join(tmpdir(), `claude-sm-${Date.now()}-${Math.random()}`);
  const repo = join(root, name);
  const home = join(root, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  git(['remote', 'add', 'origin', 'git@github.com:acme/Example.Project.git']);
  writeFileSync(join(repo, 'README.md'), '# example\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { repo, git, home };
}

function readTags(cwd, home) {
  const modulePath = join(process.cwd(), 'src', 'lib', 'container-tag.js');
  const script = `
    const tags = require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify({
      personal: tags.getContainerTag(process.argv[1]),
      project: tags.getRepoContainerTag(process.argv[1]),
      personalReads: tags.getPersonalReadTags(process.argv[1]),
      projectReads: tags.getProjectReadTags(process.argv[1]),
    }));
  `;
  const result = spawnSync('node', ['-e', script, cwd], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      USER: 'test-user',
      USERNAME: '',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

describe('unified container tags', () => {
  test('writes one stable canonical tag and reads all agent legacy tags', (t) => {
    const { repo, git, home } = makeRepo(t);
    const tags = readTags(repo, home);
    const pathHash = hash16(git(['rev-parse', '--show-toplevel']));
    const userHash = hash16('test@example.com');
    const projectHash = hash16('github.com/acme/example.project');
    const canonicalTag = `repo_example_project__${projectHash}`;

    assert.equal(tags.personal, canonicalTag);
    assert.equal(tags.project, canonicalTag);
    assert.deepEqual(tags.personalReads, [
      canonicalTag,
      `user_project_${pathHash}`,
      `claudecode_project_${pathHash}`,
      `codex_user_${userHash}`,
      `opencode_user_${userHash}`,
      `cursor_user_${userHash}`,
    ]);
    assert.deepEqual(tags.projectReads, [
      canonicalTag,
      'repo_example_project',
      `codex_project_${pathHash}`,
      ...[...new Set([hash16(repo), pathHash])].map(
        (hash) => `opencode_project_${hash}`,
      ),
      `cursor_project_${pathHash}`,
    ]);
  });

  test('uses the shared git common root for linked worktrees', (t) => {
    const { repo, git, home } = makeRepo(t, 'repo');
    git(['add', 'README.md']);
    git(['commit', '-m', 'initial']);
    const worktree = join(repo, '..', 'worktree');
    git(['worktree', 'add', '--detach', worktree, 'HEAD']);
    const repoTags = readTags(repo, home);
    const worktreeTags = readTags(worktree, home);
    assert.equal(worktreeTags.personal, repoTags.personal);
  });

  test('honors existing explicit Codex overrides for shared writes', (t) => {
    const { repo, home } = makeRepo(t);
    const codexDir = join(home, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, 'supermemory.json'),
      JSON.stringify({
        userContainerTag: 'shared_personal',
        projectContainerTag: 'shared_project',
      }),
    );

    const tags = readTags(repo, home);
    assert.equal(tags.personal, 'shared_project');
    assert.equal(tags.project, 'shared_project');
    assert.equal(tags.personalReads[0], 'shared_project');
    assert.ok(tags.personalReads.includes('shared_personal'));
    assert.equal(tags.projectReads[0], 'shared_project');
  });
});

describe('cross-container result merging', () => {
  test('globally ranks and deduplicates search results', () => {
    const merged = mergeSearchResponses(
      [
        { results: [{ id: 'old', memory: 'A', similarity: 0.4 }] },
        {
          results: [
            { id: 'best', memory: 'B', similarity: 0.9 },
            { id: 'new', memory: 'A', similarity: 0.8 },
          ],
        },
      ],
      10,
    );
    assert.deepEqual(merged.results.map((result) => result.id), ['best', 'new']);
  });

  test('deduplicates profile facts across legacy containers', () => {
    const merged = mergeProfileResponses([
      { profile: { static: ['Uses pnpm'], dynamic: ['Working on auth'] } },
      { profile: { static: ['uses pnpm'], dynamic: ['Testing agents'] } },
    ]);
    assert.deepEqual(merged.profile.static, ['Uses pnpm']);
    assert.deepEqual(merged.profile.dynamic, ['Working on auth', 'Testing agents']);
  });
});

describe('search result titles are shown when present', () => {
  test('formatSearchResults labels a hit with its title', () => {
    const output = formatSearchResults(
      'deploys',
      [{ memory: 'Deploys run from CI, never from a laptop.', title: 'Deploy policy' }],
      'Project',
    );
    assert.match(output, /Deploy policy: Deploys run from CI, never from a laptop\./);
  });

  test('formatSearchResults omits the label when there is no title', () => {
    const output = formatSearchResults(
      'deploys',
      [{ memory: 'Deploys run from CI, never from a laptop.' }],
      'Project',
    );
    assert.doesNotMatch(output, /: Deploys run from CI/);
  });

  test('formatContext labels relevant memories with their title too', () => {
    const output = formatContext(
      {
        profile: { static: [], dynamic: [] },
        searchResults: {
          results: [{ memory: 'Uses Drizzle over Prisma.', title: 'ORM choice' }],
        },
      },
      false,
      true,
    );
    assert.match(output, /ORM choice: Uses Drizzle over Prisma\./);
  });
});
