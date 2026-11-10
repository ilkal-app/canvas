import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Rollup } from 'vite';

import type { BundleVariant, EmittedAsset, LibraryBuild } from './bundle-expectations.ts';

/** The app's package folder, whose Vite config builds the library. */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Where an emitted asset came from and whether it carries that file's bytes unchanged: the
 * source paths Rollup records (`originalFileNames`), relative to the app's folder with `/`
 * separators, and a byte comparison against each source file on disk.
 *
 * @param asset - The emitted asset.
 * @returns Its provenance.
 */
function provenanceOf(asset: Rollup.OutputAsset): EmittedAsset {
  // Rollup records the path Vite resolved, which may carry the import's query (`?no-inline`).
  const sources = asset.originalFileNames.map((name) => {
    const path = name.replace(/[?#].*$/u, '');
    return (isAbsolute(path) ? relative(APP_DIR, path) : path).split('\\').join('/');
  });
  const emitted =
    typeof asset.source === 'string' ? new TextEncoder().encode(asset.source) : asset.source;
  const isSourceBytes =
    sources.length > 0 &&
    sources.every((source) => {
      const file = resolve(APP_DIR, source);
      if (!existsSync(file)) return false;
      const original = readFileSync(file);
      return (
        original.byteLength === emitted.byteLength &&
        original.every((byte, index) => byte === emitted[index])
      );
    });
  return { sources, isSourceBytes };
}

/**
 * An asset's source as text.
 *
 * @param source - The source, text or bytes.
 * @returns The text.
 */
function sourceText(source: string | Uint8Array): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source);
}

/**
 * The code the page loads with the library: the entry chunk and every chunk it imports
 * statically, transitively (a chunk shared with a lazily loaded one, such as the msdf fallback
 * handler's, sits beside the entry). Chunks loaded only by `import()` are left out.
 *
 * @param entry - The entry chunk.
 * @param chunks - Every emitted chunk by file name.
 * @returns The chunks' code, the entry's first.
 */
function startupCode(
  entry: Rollup.OutputChunk,
  chunks: ReadonlyMap<string, Rollup.OutputChunk>,
): string {
  const seen = new Set<string>([entry.fileName]);
  const order = [entry];
  // The loop visits the chunks it appends, so the closure is transitive.
  for (const chunk of order) {
    for (const name of chunk.imports) {
      const chunk = chunks.get(name);
      if (chunk === undefined || seen.has(name)) continue;
      seen.add(name);
      order.push(chunk);
    }
  }
  return order.map(({ code }) => code).join('\n');
}

/**
 * Builds the library as `pnpm build` does, but in memory (Node). Sets `VITE_CANVAS_HARNESS` in
 * this process's environment, which the build reads, so builds run one at a time.
 *
 * @param variant - `harness` builds with `VITE_CANVAS_HARNESS=1`, `production` without.
 * @returns The code the entry loads (`startupCode`), every emitted file's text, and each asset's
 *   provenance.
 * @throws {Error} When the build fails or has no entry chunk.
 */
export async function buildLibrary(variant: BundleVariant): Promise<LibraryBuild> {
  process.env.VITE_CANVAS_HARNESS = variant === 'harness' ? '1' : '';
  const result = await build({
    root: APP_DIR,
    configFile: `${APP_DIR}/vite.config.ts`,
    logLevel: 'silent',
    build: { write: false, sourcemap: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const emitted = outputs.flatMap(({ output }) => output);
  const entry = emitted.find(
    (chunk): chunk is Rollup.OutputChunk => chunk.type === 'chunk' && chunk.isEntry,
  );
  if (entry === undefined) throw new Error('The library build produced no entry chunk.');
  const files = new Map(
    emitted.map((file) => [
      file.fileName,
      file.type === 'chunk' ? file.code : sourceText(file.source),
    ]),
  );
  const chunks = new Map(
    emitted
      .filter((chunk): chunk is Rollup.OutputChunk => chunk.type === 'chunk')
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const assets = new Map(
    emitted
      .filter((asset): asset is Rollup.OutputAsset => asset.type === 'asset')
      .map((asset) => [asset.fileName, provenanceOf(asset)]),
  );
  return { entry: startupCode(entry, chunks), files, assets };
}
