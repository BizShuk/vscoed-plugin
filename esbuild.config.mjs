// esbuild.config.mjs
// Bundle the Extension Host entry and Mermaid's browser-only webview entry.
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

await build({
  entryPoints: [
    resolve(__dirname, 'mermaid_tui_preview/webview/index.mts'),
  ],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',
  outfile: resolve(
    __dirname,
    'out/mermaid_tui_preview/webview.js',
  ),
  sourcemap: false,
  minify: true,
  absWorkingDir: __dirname,
  logLevel: 'info',
});
