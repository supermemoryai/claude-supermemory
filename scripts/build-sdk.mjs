import { build } from 'esbuild';

await build({
  stdin: {
    contents: "export { Supermemory } from 'supermemory';",
    resolveDir: process.cwd(),
    sourcefile: 'supermemory-runtime.js',
  },
  outfile: 'plugin/hooks/vendor/supermemory.cjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: true,
  legalComments: 'none',
});
