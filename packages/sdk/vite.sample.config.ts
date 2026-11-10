import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// The sample host page (`sample/`) built on the built SDK, as a host's own bundler builds it: its
// `@ilkal/sdk` import is the bundle `pnpm build` writes (dist/index.js), and React is the page's
// own, the SDK's peer. `pnpm sample:built` builds the SDK, then the page into sample/dist, and
// serves it. The scenario suite builds the page with this file too, on an SDK built elsewhere.
export default defineConfig({
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
