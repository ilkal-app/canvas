// Writes the CJK faces' slice files: each of the five CJK coverage faces (Noto Sans
// SC, TC, HK, JP, KR, regular and bold) cut into the slices `cjkSlices` names, with HarfBuzz's
// hb-subset, under assets/fonts/cjk/<sc|tc|hk|jp|kr>/<weight>-<id>.ttf. They are build output, not
// committed: a stamp per face (the sha256 the coverage catalogue lists) skips a face whose files
// were already written from the same file. It runs as the uncached turbo task `slices`, which
// every build and the root test task depend on, and before the app's dev server and site build;
// a bare `vite build` in packages/app needs it run first.
//   node --experimental-strip-types scripts/build-cjk-slices.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCjkSlices, createSubsetter, HAN_LANGUAGE_FAMILIES } from '@canvas/text';

/** The coverage faces' folder. */
const COVERAGE = fileURLToPath(new URL('../assets/fonts/script-coverage/', import.meta.url));

/** Where the slices go by default. */
const SLICES = fileURLToPath(new URL('../assets/fonts/cjk/', import.meta.url));

/** A coverage catalogue face, as catalogue.json lists it. */
interface CatalogueFace {
  readonly weight: number;
  readonly url: string;
  readonly sha256: string;
}

/**
 * The CJK faces' files and hashes, from the coverage catalogue.
 *
 * @returns Each face's family, weight, file (`notosanssc/400.ttf`) and sha256.
 */
function cjkFaces(): { family: string; weight: number; url: string; sha256: string }[] {
  const catalogue = JSON.parse(readFileSync(join(COVERAGE, 'catalogue.json'), 'utf8')) as {
    entries: { family: string; faces: CatalogueFace[] }[];
  };
  return catalogue.entries
    .filter(({ family }) => HAN_LANGUAGE_FAMILIES.includes(family))
    .flatMap(({ family, faces }) => faces.map((face) => ({ family, ...face })));
}

/**
 * Reads hb-subset's WebAssembly build from harfbuzzjs, the shaper's own package.
 *
 * @returns The wasm's bytes.
 */
function subsetWasm(): Uint8Array {
  const textEntry = createRequire(import.meta.url).resolve('@canvas/text');
  const wasm = createRequire(textEntry).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
  return readFileSync(wasm);
}

/**
 * Writes every CJK face's slices that are not already written from the same face file.
 *
 * @param outDir - Where the slices go; assets/fonts/cjk by default.
 * @returns How many slice files were written, and how many faces were skipped as up to date.
 */
export async function buildCjkSliceFiles(
  outDir: string = SLICES,
): Promise<{ readonly written: number; readonly skipped: number }> {
  const subsetter = await createSubsetter(subsetWasm());
  let written = 0;
  let skipped = 0;
  for (const { family, weight, url, sha256 } of cjkFaces()) {
    // A short folder (sc, tc, hk, jp, kr), so each slice's URL fits on a line.
    const folder = join(outDir, dirname(url).replace(/^notosans/u, ''));
    // The face's licence travels with its slices (OFL-1.1): a server ships them.
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(COVERAGE, dirname(url), 'LICENSE.txt'), join(folder, 'LICENSE.txt'));
    const stamp = join(folder, `${String(weight)}.sha256`);
    if (existsSync(stamp) && readFileSync(stamp, 'utf8') === sha256) {
      skipped += 1;
      continue;
    }
    const font = new Uint8Array(readFileSync(join(COVERAGE, url)));
    for (const [id, bytes] of buildCjkSlices(subsetter, family, font)) {
      writeFileSync(join(folder, `${String(weight)}-${id}.ttf`), bytes);
      written += 1;
    }
    // The stamp last: an interrupted run writes the face again.
    writeFileSync(stamp, sha256);
  }
  return { written, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { written, skipped } = await buildCjkSliceFiles();
  process.stdout.write(
    `build-cjk-slices: ${String(written)} slice file(s) written, ${String(skipped)} face(s) up to date\n`,
  );
}
