// Bundles the shared routing package from the Supermemory monorepo
// (packages/agent-config) into a single CommonJS file the hooks can require.
// Run with SUPERMEMORY_MONO_DIR pointing at a mono checkout.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const mono = resolve(process.env.SUPERMEMORY_MONO_DIR || '../mono');
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: mono,
  encoding: 'utf-8',
}).trim();

await build({
  entryPoints: [join(mono, 'packages/agent-config/index.ts')],
  outfile: 'plugin/hooks/vendor/agent-config.cjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: false,
  legalComments: 'none',
  banner: {
    js: `// Generated from supermemoryai/mono packages/agent-config @ ${commit}. Do not edit; run npm run build:agent-config.`,
  },
});
