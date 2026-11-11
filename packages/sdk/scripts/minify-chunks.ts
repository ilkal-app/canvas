// Minifies the SDK's JavaScript. Library mode leaves an ES build's whitespace and names
// as they are, so the bundle stayed as written: about 95,000 lines in the main chunk. Every chunk,
// the workers' included, is minified with esbuild once the bundle is generated, keeping the
// licence comments third-party licences ask for (`/*! … */`, `@license`, `@preserve`) where
// they are. Imports and exports keep their names, so the chunks still load one another, and the
// URLs a host's bundler follows (`new URL('…', import.meta.url)`, `new Worker(…)`) keep their
// shape. Template literals (the shaders' source) keep their lines.
import { transformWithEsbuild, type Plugin } from 'vite';

/**
 * Minifies one chunk's code: whitespace, syntax and local names, legal comments kept inline.
 *
 * @param code - The chunk's code, an ES module.
 * @param fileName - Its name, for esbuild's messages.
 * @returns The minified code.
 */
export async function minifyChunk(code: string, fileName: string): Promise<string> {
  const minified = await transformWithEsbuild(code, fileName, {
    minify: true,
    legalComments: 'inline',
    format: 'esm',
    sourcemap: false,
  });
  return minified.code;
}

/**
 * Minifies every chunk of the bundle ({@link minifyChunk}) after every chunk is rendered: Vite's
 * own transpile step, which runs at renderChunk, prints an ES library's code out again in full.
 *
 * @returns The plugin.
 */
export function minifyChunks(): Plugin {
  return {
    name: 'canvas-sdk:minify-chunks',
    apply: 'build',
    enforce: 'post',
    async generateBundle(outputOptions, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') output.code = await minifyChunk(output.code, output.fileName);
      }
    },
  };
}
