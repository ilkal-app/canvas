import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

/**
 * Copies the built SDK's font files (its dist/fonts/, the fonts package's files) beside
 * the page, into fonts/, as a self-hosting host would: `?fontsUrl=fonts/` loads them from there.
 * Without it the page loads them from jsDelivr, as a host does by default.
 *
 * @returns The plugin.
 */
function copyFontsBesideThePage(): Plugin {
  let from = '';
  let to = '';
  return {
    name: 'canvas-sdk-sample:copy-fonts',
    apply: 'build',
    configResolved(config) {
      // The bundle the page is built on: this file's alias, or the one a caller puts first.
      const sdk = config.resolve.alias.find(({ find }) => find === '@ilkal/sdk');
      from = join(dirname(String(sdk?.replacement)), 'fonts');
      to = join(resolve(config.root, config.build.outDir), 'fonts');
    },
    closeBundle() {
      if (existsSync(from)) cpSync(from, to, { recursive: true });
    },
  };
}

// The sample host page (`sample/`) built on the built SDK, as a host's own bundler builds it: its
// `@ilkal/sdk` import is the bundle `pnpm build` writes (dist/index.js), and React is the page's
// own, the SDK's peer. `pnpm sample:built` builds the SDK, then the page into sample/dist, with
// the SDK's font files in sample/dist/fonts/ (`?fontsUrl=fonts/`), and serves it. The scenario suite builds the page with this file too, on an SDK built elsewhere.
export default defineConfig({
  plugins: [copyFontsBesideThePage()],
  root: fileURLToPath(new URL('sample', import.meta.url)),
  base: './',
  resolve: {
    alias: { '@ilkal/sdk': fileURLToPath(new URL('dist/index.js', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The page awaits `mount` at its top level.
    target: 'es2022',
    // The bundle is the SDK's whole shell and engine; the host splits nothing here.
    chunkSizeWarningLimit: 8192,
  },
  // Cross-origin isolated, as the scenario suite serves it.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
