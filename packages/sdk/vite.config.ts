import { readFileSync } from 'node:fs';

import MagicString from 'magic-string';
import { defineConfig, type Plugin } from 'vite';

import { defaultFontsUrl, FONT_FILE_SCHEME, fontFilesOutside } from './scripts/font-files.ts';

/**
 * A package's name and version, from its package.json.
 *
 * @param path - The package.json, relative to this file.
 * @returns The two.
 */
function manifestOf(path: string): { readonly name: string; readonly version: string } {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    readonly name: string;
    readonly version: string;
  };
}

// The fonts load from the fonts package at the SDK's own version (the two are released
// together), from jsDelivr unless the host says otherwise (`fontsUrl`).
const FONTS_URL = defaultFontsUrl(
  manifestOf('../fonts/package.json').name,
  manifestOf('./package.json').version,
);

// `new URL("<file>", import.meta.url)` naming an asset other than a script or a font: the wasm
// module (the fonts are taken out first, `fontFilesOutside`). Workers (`.js`) are bundled by
// Vite's worker plugin.
const ASSET_URL = /new URL\((["'])([^"'?#]+\.(?!m?js\1)[a-z0-9]+)\1,\s*import\.meta\.url\)/gu;

// Library mode inlines every asset as base64 unless its URL says `?no-inline`. A dist that names
// an asset without the query would put it into the JavaScript: add the query back to each asset
// URL, so it stays a file beside the bundle that a page fetches only when it needs it.
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
  plugins: [fontFilesOutside({ shouldEmit: true }), keepAssetsAsFiles(), importExtractedCss()],
  // Relative asset URLs, so the workers and the wasm resolve next to dist/index.js wherever a
  // host serves it.
  base: './',
  // How the bundle names a font file, and where it loads them from by default
  // (src/mount/fonts-url.ts).
  define: {
    CANVAS_SDK_FONTS: JSON.stringify({ scheme: FONT_FILE_SCHEME, defaultUrl: FONTS_URL }),
  },
  // The workspace's sources, not their dists (each of which bundles its own copy of what it
  // uses): one graph, so Yjs and the document layer are bundled once.
  resolve: { conditions: ['development', 'module', 'browser'] },
  // The workers name the catalogue's fonts too (by face, never fetching them): the same names.
  worker: { format: 'es', plugins: () => [fontFilesOutside({ shouldEmit: false })] },
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
        // The font files are named by their path in the fonts package (`fontFilesOutside`); the
        // stylesheet, which the entry imports by name, and the wasm keep their own names.
        assetFileNames: '[name][extname]',
      },
    },
    sourcemap: true,
  },
});
