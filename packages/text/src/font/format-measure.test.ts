// The measurement behind's parser decision: our parser
// and HarfBuzz's drawGlyph on the format corpus, for coverage, speed and malformed input. It runs
// only on request, `MEASURE_FONT_FORMATS=1 vitest run --project @canvas/text format-measure`, and
// prints its table; it asserts nothing, so the gate never depends on timing.
import { readdirSync, readFileSync } from 'node:fs';

import type * as HarfBuzzModule from 'harfbuzzjs';
import { describe, it } from 'vitest';

import { parseFont } from './parse-font.js';

type HarfBuzz = typeof HarfBuzzModule;
type HbFont = InstanceType<HarfBuzz['Font']>;

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);

/** Repeats per timing; the median is reported. */
const REPEATS = 15;

/** Mutated cases per format in the robustness run. */
const FUZZ_CASES = 1_500;

/** The most glyphs drawn per mutated face: a corrupt maxp can claim 65,535. */
const FUZZ_GLYPHS = 400;

/**
 * The median of some numbers.
 *
 * @param values - The numbers.
 * @returns Their median.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/**
 * A seeded generator of numbers in [0, 1) (a linear congruential generator).
 *
 * @param seed - The seed.
 * @returns The generator.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * One malformed copy of a font: bytes overwritten, the file truncated, the table directory
 * corrupted, or a word set to an extreme value.
 *
 * @param bytes - The font.
 * @param random - The generator.
 * @returns The copy.
 */
function mutate(bytes: Uint8Array, random: () => number): Uint8Array {
  const copy = bytes.slice();
  const at = (length: number): number => Math.floor(random() * length);
  switch (at(4)) {
    case 0:
      for (let index = 0; index < 1 + at(8); index += 1) copy[at(copy.length)] = at(256);
      return copy;
    case 1:
      return copy.slice(0, at(copy.length));
    case 2:
      for (let index = 0; index < 4; index += 1)
        copy[12 + at(Math.min(copy.length, 12 + 16 * 24) - 12)] = at(256);
      return copy;
    default:
      new DataView(copy.buffer).setUint32(
        at(copy.length - 4),
        random() < 0.5 ? 0xffffffff : 0x7fffffff,
      );
      return copy;
  }
}

/** Draws glyphs through one set of draw functions: harfbuzzjs keeps every set it is given. */
class Drawer {
  private operations = 0;
  private readonly funcs: InstanceType<HarfBuzz['DrawFuncs']>;

  constructor(hb: HarfBuzz) {
    this.funcs = new hb.DrawFuncs();
    const count = (): void => {
      this.operations += 1;
    };
    this.funcs.setMoveToFunc(count);
    this.funcs.setLineToFunc(count);
    this.funcs.setQuadraticToFunc(count);
    this.funcs.setCubicToFunc(count);
    this.funcs.setClosePathFunc(count);
  }

  /**
   * Draws a glyph.
   *
   * @param font - The font.
   * @param glyph - The glyph id.
   * @returns How many draw operations it made.
   */
  draw(font: HbFont, glyph: number): number {
    this.operations = 0;
    font.drawGlyph(glyph, this.funcs);
    return this.operations;
  }
}

/**
 * Opens a face with HarfBuzz and runs a function on it (harfbuzzjs frees its objects when they
 * are collected).
 *
 * @param hb - HarfBuzz.
 * @param bytes - The font file.
 * @param use - What to do with the font and its glyph count (from maxp; 0 without one).
 * @returns What `use` returned.
 */
function withHbFont<T>(
  hb: HarfBuzz,
  bytes: Uint8Array,
  use: (font: HbFont, glyphs: number) => T,
): T {
  const blob = new hb.Blob(bytes.slice().buffer);
  const face = new hb.Face(blob, 0);
  const font = new hb.Font(face);
  const maxp = face.referenceTable('maxp');
  const glyphs =
    maxp === undefined || maxp.length < 6
      ? 0
      : new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
  return use(font, glyphs);
}

/**
 * Draws every glyph of a face with our parser.
 *
 * @param bytes - The font file.
 * @param glyphs - How many glyphs.
 * @returns How many segments the outlines had.
 */
function oursOutlines(bytes: Uint8Array, glyphs: number): number {
  const font = parseFont(bytes);
  let segments = 0;
  for (let glyph = 0; glyph < glyphs; glyph += 1)
    segments += font.outlineOf(glyph).contours.reduce((sum, contour) => sum + contour.length, 0);
  return segments;
}

/**
 * Names how a malformed case ended: it drew something, drew nothing, or threw.
 *
 * @param run - Draws the case's glyphs; returns how much it drew.
 * @returns `drew`, `drew nothing`, or the error's name.
 */
function outcome(run: () => number): string {
  try {
    return run() > 0 ? 'drew' : 'drew nothing';
  } catch (error) {
    return error instanceof Error ? error.name : 'non-error';
  }
}

describe.runIf(process.env.MEASURE_FONT_FORMATS === '1')('font formats', () => {
  it('measures coverage, speed and malformed input', { timeout: 600_000 }, async () => {
    const startMs = performance.now();
    const hb = await import('harfbuzzjs');
    const lines = [
      `harfbuzz ${hb.versionString()} loaded in ${(performance.now() - startMs).toFixed(1)} ms`,
    ];
    const drawer = new Drawer(hb);
    const names = readdirSync(CORPUS).filter((name) => !/\.(?:json|txt|md)$/u.test(name));
    for (const name of names) {
      const bytes = new Uint8Array(readFileSync(new URL(name, CORPUS)));
      const glyphs = withHbFont(hb, bytes, (font, count) => count);
      const time = (run: () => number): string => {
        try {
          const times: number[] = [];
          let drawn = 0;
          for (let repeat = 0; repeat < REPEATS; repeat += 1) {
            const repeatMs = performance.now();
            drawn = run();
            times.push(performance.now() - repeatMs);
          }
          return drawn === 0 ? 'nothing drawn' : `${median(times).toFixed(2)} ms`;
        } catch (error) {
          return error instanceof Error ? `${error.name}: ${error.message.slice(0, 50)}` : 'error';
        }
      };
      const ours = time(() => oursOutlines(bytes, glyphs));
      const harfbuzz = time(() =>
        withHbFont(hb, bytes, (font, count) => {
          let operations = 0;
          for (let glyph = 0; glyph < count; glyph += 1) operations += drawer.draw(font, glyph);
          return operations;
        }),
      );
      lines.push(`${name}: ${String(glyphs)} glyphs | ours ${ours} | harfbuzz ${harfbuzz}`);
    }
    for (const name of [
      'corpus-sans-regular.ttf',
      'corpus-sans-regular.cff.otf',
      'corpus-sans-regular.cff2.otf',
      'corpus-sans.ttc',
    ]) {
      const bytes = new Uint8Array(readFileSync(new URL(name, CORPUS)));
      const random = seeded(511);
      const tallies = { ours: new Map<string, number>(), harfbuzz: new Map<string, number>() };
      let oursWorstMs = 0;
      let harfbuzzWorstMs = 0;
      let mostOperations = 0;
      for (let index = 0; index < FUZZ_CASES; index += 1) {
        const sample = mutate(bytes, random);
        let caseMs = performance.now();
        // Both draw the same glyphs: ids 0 to the mutated maxp's count, at most FUZZ_GLYPHS.
        const glyphs = Math.min(
          withHbFont(hb, sample, (font, count) => count),
          FUZZ_GLYPHS,
        );
        const oursEnd = outcome(() => oursOutlines(sample, glyphs));
        oursWorstMs = Math.max(oursWorstMs, performance.now() - caseMs);
        tallies.ours.set(oursEnd, (tallies.ours.get(oursEnd) ?? 0) + 1);
        caseMs = performance.now();
        const harfbuzzEnd = outcome(() =>
          withHbFont(hb, sample, (font) => {
            let operations = 0;
            for (let glyph = 0; glyph < glyphs; glyph += 1) {
              const drawn = drawer.draw(font, glyph);
              mostOperations = Math.max(mostOperations, drawn);
              operations += drawn;
            }
            return operations;
          }),
        );
        harfbuzzWorstMs = Math.max(harfbuzzWorstMs, performance.now() - caseMs);
        tallies.harfbuzz.set(harfbuzzEnd, (tallies.harfbuzz.get(harfbuzzEnd) ?? 0) + 1);
      }
      const isStillDrawing = withHbFont(hb, bytes, (font) => drawer.draw(font, 36)) > 0;
      lines.push(
        `fuzz ${name} x${String(FUZZ_CASES)}: ours ${JSON.stringify([...tallies.ours])}, worst ${oursWorstMs.toFixed(1)} ms | harfbuzz ${JSON.stringify([...tallies.harfbuzz])}, worst ${harfbuzzWorstMs.toFixed(1)} ms, most draw operations ${String(mostOperations)}, the intact face still draws after: ${String(isStillDrawing)}`,
      );
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});
