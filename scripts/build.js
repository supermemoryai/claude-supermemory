#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'plugin', 'scripts');

const hooks = [
  'context-hook',
  'prompt-hook',
  'observation-hook',
  'summary-hook',
  'search-memory'
];

async function build() {
  console.log('Building hooks...\n');

  fs.mkdirSync(OUT, { recursive: true });

  for (const hook of hooks) {
    const entry = path.join(SRC, `${hook}.js`);
    const out = path.join(OUT, `${hook}.cjs`);

    try {
      await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        outfile: out,
        minify: true,
        banner: { js: '#!/usr/bin/env node' },
        loader: { '.html': 'text' }
      });

      fs.chmodSync(out, 0o755);
      const stats = fs.statSync(out);
      console.log(`  ${hook}.cjs (${(stats.size / 1024).toFixed(1)} KB)`);

    } catch (err) {
      console.error(`Failed to build ${hook}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nBuild complete!');
}

build();
