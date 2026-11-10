import { defineConfig, type Plugin } from 'vite';

// Library mode extracts the CSS modules into dist/index.css but leaves the JavaScript without an
// import of it, so a consumer would get an unstyled shell. Once Vite has extracted the stylesheet
// (hence `enforce: 'post'`), prefix the entry with that import, on its first line so source maps
// stay aligned; package.json marks CSS as a side effect so bundlers keep it.
function importExtractedCss(): Plugin {
  return {
    name: 'canvas:import-extracted-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const stylesheets = Object.values(bundle).filter(
        (output) => output.type === 'asset' && output.fileName.endsWith('.css'),
      );
      const imports = stylesheets.map(({ fileName }) => `import './${fileName}';`).join('');
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) output.code = imports + output.code;
      }
    },
  };
}

// Library build: the shell is consumed by @ilkal/sdk, which decides how React is provided.
// `vite` (the dev server) serves index.html, a standalone page around the shell.
export default defineConfig({
  plugins: [importExtractedCss()],
  // Relative asset URLs, so the engine worker the library emits (dist/assets/engine-worker-*.js)
  // resolves next to dist/index.js wherever a consumer serves it, not from the site's root.
  base: './',
  // The engine worker is an ES module (spawn-engine-worker.ts starts it with type 'module').
  worker: { format: 'es' },
  // harfbuzzjs finds harfbuzz.wasm next to its own module (new URL(…, import.meta.url)). The dev
  // server's dependency optimiser would move the module into .vite/deps, where no wasm is, and
  // shaping would fetch index.html instead. Builds emit the wasm as an asset.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: [/^react(-dom)?($|\/)/],
      // zod (through @canvas/document) places `@__PURE__` comments where Rollup cannot use
      // them; Rollup drops them and says so for every build. Only that notice, only from
      // node_modules, is silenced.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/')) return;
        warn(warning);
      },
      output: {
        // The font files (the text fonts' TrueType and the chrome's WOFF2) carry a content hash,
        // as the chunks and worker scripts do, so a changed font gets a new URL and a long-lived
        // cache never serves the old one. Other assets (the extracted stylesheet, which the
        // entry imports by name) keep their names.
        assetFileNames: (asset) =>
          asset.names.some((name) => /\.(?:ttf|woff2)$/u.test(name))
            ? 'assets/[name]-[hash][extname]'
            : '[name][extname]',
      },
    },
    sourcemap: true,
  },
});
