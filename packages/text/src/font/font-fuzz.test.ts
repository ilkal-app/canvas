// The font fuzz: seeded mutations of the format corpus through everything that reads
// font bytes, the web-font decoder, the parser, collections and HarfBuzz's shaping and outlines,
// each of which must fail
// a bad face with a FontFormatError (or, for HarfBuzz, not at all), never another error; a web
// font that decodes goes on through the rest. Every
// run of the unit suite fuzzes seed 511 a little; the nightly workflow fuzzes a fresh seed at
// scale (FONT_FUZZ_SEED, FONT_FUZZ_ITERATIONS). A failure names
// its seed, input and case: FONT_FUZZ_SEED=<seed> FONT_FUZZ_CASE=<case> replays that one case.
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createShaper, shapeText } from '../shaping/shaper.js';

import { collectionFaceCount, extractFace, postScriptNamesOf } from './font-collection.js';
import { FontFormatError } from './font-format-error.js';
import { parseFont } from './parse-font.js';
import { decodeWebFont, webFontFormatOf } from './web-font.js';

const SEED = Number(process.env.FONT_FUZZ_SEED ?? '511');
const ITERATIONS = Number(process.env.FONT_FUZZ_ITERATIONS ?? '100');
const ONLY_CASE =
  process.env.FONT_FUZZ_CASE === undefined ? undefined : Number(process.env.FONT_FUZZ_CASE);
const INPUTS = [
  'corpus-sans-regular.ttf',
  'corpus-serif-regular.ttf',
  'corpus-sans-regular.cff.otf',
  'corpus-sans-bold.cff2.otf',
  'corpus-sans-variable.ttf',
  'corpus-sans.ttc',
  'corpus-sans-regular.woff',
  'corpus-serif-regular.woff2',
  'corpus-sans-regular.hmtx.woff2',
];
const SAMPLE = 'Hamburgefonstiv 0123 ÀÉÎõü';

/**
 * A seeded generator (a 32-bit LCG): the same seed gives the same mutations on every machine.
 *
 * @param seed - The seed.
 * @returns Numbers in [0, 1).
 */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * One mutation of a font file: random bytes overwritten, the file cut short, or a table record's
 * offset or length, or the table count, set to a random value.
 *
 * @param source - The file.
 * @param random - The generator.
 * @returns The mutated copy.
 */
function mutate(source: Uint8Array, random: () => number): Uint8Array {
  const kind = Math.floor(random() * 4);
  const out = kind === 1 ? source.slice(0, Math.floor(random() * source.length)) : source.slice();
  const view = new DataView(out.buffer);
  if (kind === 2 && out.length >= 12) {
    const count = Math.min(view.getUint16(4), Math.floor((out.length - 12) / 16));
    const record = 12 + 16 * Math.floor(random() * Math.max(count, 1));
    const field = record + 8 + 4 * Math.floor(random() * 2);
    if (field + 4 <= out.length) view.setUint32(field, Math.floor(random() * 2 ** 32));
  } else if (kind === 3 && out.length >= 6) {
    view.setUint16(4, Math.floor(random() * 2 ** 16));
  } else {
    const flips = 1 + Math.floor(random() * 8);
    for (let flip = 0; flip < flips && out.length > 0; flip += 1) {
      out[Math.floor(random() * out.length)] = Math.floor(random() * 256);
    }
  }
  return out;
}

/**
 * Runs a read, letting only a FontFormatError through.
 *
 * @param read - The read.
 * @returns The error's name when something else was thrown, else `undefined`.
 */
function strayErrorOf(read: () => void): string | undefined {
  try {
    read();
  } catch (error) {
    if (error instanceof FontFormatError) return undefined;
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return undefined;
}

/**
 * The cases between collections: each makes a face of its own, so at most about a thousand
 * faces' files are live in HarfBuzz's memory at once.
 */
const CASES_PER_COLLECTION = 1000;

// harfbuzzjs frees a blob, face or font only from a FinalizationRegistry callback, after the
// garbage collector has found its object unreachable and the event loop has run. The fuzz makes a
// face per case in a loop that seldom yields, and the garbage collector does not see HarfBuzz's
// memory, so nothing was freed: over the first four inputs HarfBuzz's memory reached its 2 GiB
// ceiling, malloc failed, harfbuzzjs wrote the next file over address 0 and every later call
// trapped (seed 37). The fuzz collects and yields every CASES_PER_COLLECTION cases, as an
// editor's event loop does between uses, so the faces it dropped are freed.
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;

/**
 * Collects garbage and yields to the event loop, so harfbuzzjs's finalizers run and free the
 * HarfBuzz memory of every face the fuzz no longer holds.
 */
async function freeDroppedFaces(): Promise<void> {
  collectGarbage();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

const hb = await import('harfbuzzjs');

describe(`font fuzz, seed ${String(SEED)}, ${String(ITERATIONS)} cases per input`, () => {
  for (const [inputIndex, name] of INPUTS.entries()) {
    it(`contains every mutation of ${name}`, { timeout: 600_000 }, async () => {
      const source = Uint8Array.from(
        readFileSync(new URL(`../__fixtures__/format-corpus/${name}`, import.meta.url)),
      );
      // A small budget, so the shaper drops and reads files again as the fuzz goes.
      const shaper = createShaper(hb, { maxFaceBytes: 256 * 1024 });
      const random = generator(SEED + inputIndex * 0x9e3779b1);
      const strays: string[] = [];
      for (let index = 0; index < ITERATIONS; index += 1) {
        const mutated = mutate(source, random);
        if (index % CASES_PER_COLLECTION === CASES_PER_COLLECTION - 1) await freeDroppedFaces();
        if (ONLY_CASE !== undefined && index !== ONLY_CASE) continue;
        // A web font is decoded first; one that decodes is read on as the sfnt it gave.
        let bytes = mutated;
        if (webFontFormatOf(source) !== undefined) {
          const decoded = await decodeWebFont(mutated).then(
            (sfnt) => ({ sfnt }),
            (error: unknown) => ({ error }),
          );
          if ('error' in decoded) {
            if (!(decoded.error instanceof FontFormatError)) {
              strays.push(`case ${String(index)}: decode: ${String(decoded.error)}`);
            }
            continue;
          }
          bytes = decoded.sfnt;
        }
        const stray =
          strayErrorOf(() => {
            const font = parseFont(bytes);
            for (let glyph = 0; glyph < 64; glyph += 1) font.outlineOf(glyph);
            font.kerningPairs();
          }) ??
          strayErrorOf(() => {
            const faces = collectionFaceCount(bytes);
            postScriptNamesOf(bytes);
            for (let face = 0; face < Math.min(faces, 4); face += 1) extractFace(bytes, face);
          }) ??
          strayErrorOf(() => {
            // HarfBuzz reads anything; it must neither throw nor hang.
            const face = shaper.face(`case-${String(index)}`, bytes, { wght: 600 });
            shapeText(shaper, face, SAMPLE, 0, SAMPLE.length);
            for (let glyph = 0; glyph < 64; glyph += 1) shaper.outline(face, glyph);
          });
        if (stray !== undefined) strays.push(`case ${String(index)}: ${stray}`);
      }
      expect(
        strays,
        `seed ${String(SEED)}, ${name}; replay with FONT_FUZZ_SEED=${String(SEED)} FONT_FUZZ_CASE=<case>`,
      ).toEqual([]);
      expect(shaper.retainedFaceBytes).toBeLessThanOrEqual(256 * 1024 + source.length);
    });
  }
});
