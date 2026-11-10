import { expect, it } from 'vitest';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { createFontMetrics, subsetFontMetrics, type FontMetrics } from './font-metrics.js';
import { parseFont } from './parse-font.js';

function reference(metrics: FontMetrics, codepoints: readonly number[]): FontMetrics {
  const wanted = new Set(codepoints);
  return {
    ...metrics,
    advances: metrics.advances.filter(([codepoint]) => wanted.has(codepoint)),
    kerning: metrics.kerning.filter(([left, right]) => wanted.has(left) && wanted.has(right)),
  };
}

it('matches full-table filtering for sparse and dense subsets of every bundled face', () => {
  let seed = 126;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (const { face, bytes } of loadBundledFaces()) {
    const metrics = createFontMetrics(face, parseFont(bytes));
    const points = metrics.advances.map(([point]) => point);
    const subsets = [[], points, [...points].reverse(), [0x1f600, 0x10ffff, 65, 65]];
    for (let sample = 0; sample < 24; sample += 1) {
      const fraction = sample % 2 === 0 ? 0.005 : 0.75;
      subsets.push(points.filter(() => random() < fraction).reverse());
    }
    for (const wanted of subsets) {
      const actual = subsetFontMetrics(metrics, wanted);
      expect(actual).toEqual(reference(metrics, wanted));
      expect(subsetFontMetrics(actual, [65, 86, 111])).toEqual(reference(actual, [65, 86, 111]));
    }
  }
});

it('preserves duplicate sorted rows and metadata without changing frozen inputs', () => {
  const metrics: FontMetrics = Object.freeze({
    face: Object.freeze({ family: 'fixture', weight: 400, isItalic: false }),
    ascent: 1,
    descent: 0.2,
    missingAdvance: 0.6,
    advances: Object.freeze(
      [
        [65, 0.5],
        [65, 0.6],
        [86, 0.7],
        [111, 0.4],
      ].map((row) => Object.freeze(row) as readonly [number, number]),
    ),
    kerning: Object.freeze(
      [
        [65, 86, -0.1],
        [65, 86, -0.2],
        [86, 111, -0.3],
      ].map((row) => Object.freeze(row) as readonly [number, number, number]),
    ),
  });
  const actual = subsetFontMetrics(metrics, [86, 65, 86]);
  expect(actual).toEqual(reference(metrics, [86, 65, 86]));
  expect(actual.face).toBe(metrics.face);
  expect(actual.advances[0]).toBe(metrics.advances[0]);
  expect(actual.kerning[1]).toBe(metrics.kerning[1]);
});

it('does not read thousands of unrelated sorted rows for a two-character subset', () => {
  let rowReads = 0;
  const track = <T>(rows: readonly T[]): readonly T[] =>
    new Proxy(rows, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) rowReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  const metrics: FontMetrics = {
    face: { family: 'fixture', weight: 400, isItalic: false },
    ascent: 1,
    descent: 0.2,
    missingAdvance: 0.6,
    advances: track(Array.from({ length: 4096 }, (unused, point) => [point, 0.5] as const)),
    kerning: track(Array.from({ length: 4096 }, (unused, point) => [point, point, -0.1] as const)),
  };
  expect(subsetFontMetrics(metrics, [3, 4094])).toMatchObject({
    advances: [
      [3, 0.5],
      [4094, 0.5],
    ],
    kerning: [
      [3, 3, -0.1],
      [4094, 4094, -0.1],
    ],
  });
  expect(rowReads).toBeLessThan(256);
});

it('consumes a one-shot iterable once and ignores unknown values without reordering valid rows', () => {
  const [face] = loadBundledFaces();
  if (face === undefined) throw new Error('Missing bundled face');
  const metrics = createFontMetrics(face.face, parseFont(face.bytes));
  const wanted = [86, Number.NaN, 65, Infinity, -Infinity, 86, 0x1f600];
  function* once(): Generator<number> {
    yield* wanted;
  }
  const iterable = once();
  expect(subsetFontMetrics(metrics, iterable)).toEqual(reference(metrics, wanted));
  expect(iterable.next().done).toBe(true);
});
