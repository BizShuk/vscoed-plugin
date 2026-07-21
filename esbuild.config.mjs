// esbuild.config.mjs
// Bundle VSCode extension into a single CJS file.
// Bundles @anthropic-ai/sdk and openai inline; marks `vscode` as external
// because the VSCode Extension Host injects it as a global at runtime.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(__dirname, 'out/src/extension.js'),
  external: ['vscode'],
  sourcemap: false,
  minify: true,
  absWorkingDir: __dirname,
  logLevel: 'info',
});