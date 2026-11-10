import MagicString from 'magic-string';
import { defineConfig, type Plugin } from 'vite';

// `new URL("<file>", import.meta.url)` naming an asset other than a script: the text fonts' TrueType
// files, the chrome's WOFF2, a wasm module. Workers (`.js`) are bundled by Vite's worker plugin.
const ASSET_URL = /new URL\((["'])([^"'?#]+\.(?!m?js\1)[a-z0-9]+)\1,\s*import\.meta\.url\)/gu;

// Library mode inlines every asset as base64 unless its URL says `?no-inline`. The shell's own
// build keeps its fonts as files that way, but its dist names them without the query, so bundling
// it again here would put every font (over a thousand, 160 MB) into the JavaScript. Add the
// query back to each asset URL, so the fonts stay content-hashed files beside the bundle that a
// page fetches only when text needs them.
function keepAssetsAsFiles(): Plugin {
  return {
    name: 'canvas-sdk:keep-assets-as-files',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.m?js$/u.test(id.replace(/[?#].*$/u, '')) || !code.includes('import.meta.url')) {
        return undefined;
      }
      const edited = new MagicString(code);
      for (const match of code.matchAll(ASSET_URL)) {
        const end = match.index + match[0].indexOf(match[2]) + match[2].length;
        edited.appendLeft(end, '?no-inline');
      }
      if (!edited.hasChanged()) return undefined;
      return { code: edited.toString(), map: edited.generateMap({ hires: true, source: id }) };
    },
  };
}

// Library mode extracts the CSS into dist/index.css but leaves the JavaScript without an import
// of it, so a host would get an unstyled board (as in @canvas/app's own build). Prefix the entry
// with that import, on its first line so source maps stay aligned; package.json marks CSS as a
// side effect so a host's bundler keeps it.
function importExtractedCss(): Plugin {
  return {
    name: 'canvas-sdk:import-extracted-css',
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

// The embeddable bundle: one ES module a host page loads. React is the host's (a peer dependency):
// two copies of React on one page break hooks, so it is left out of the bundle.
export default defineConfig({
  plugins: [keepAssetsAsFiles(), importExtractedCss()],
  // Relative asset URLs, so the fonts and workers resolve next to dist/index.js wherever a host
  // serves it.
  base: './',
  // The workspace's sources, not their dists (each of which bundles its own copy of what it
  // uses): one graph, so Yjs and the document layer are bundled once.
  resolve: { conditions: ['development', 'module', 'browser'] },
  worker: { format: 'es' },
  // harfbuzzjs finds harfbuzz.wasm next to its own module (new URL(…, import.meta.url)). The dev
  // server's dependency optimiser would move the module into .vite/deps, where no wasm is, and
  // shaping would fetch the page instead (as for @canvas/app): the sample host page
  // (`sample/`) is served by the dev server.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: {
      external: [/^react(-dom)?($|\/)/],
      output: {
        // The fonts carry a content hash (as @canvas/app's own build names them): many families
        // ship a `400.ttf`, and without the hash those names collide and are numbered in whatever
        // order the build finishes them, so no two builds agree; with it a changed font
        // also gets a new URL. The stylesheet, which the entry imports by name, keeps its own.
        assetFileNames: (asset) =>
          asset.names.some((name) => /\.(?:ttf|woff2)$/u.test(name))
            ? 'assets/[name]-[hash][extname]'
            : '[name][extname]',
      },
    },
    sourcemap: true,
  },
});
