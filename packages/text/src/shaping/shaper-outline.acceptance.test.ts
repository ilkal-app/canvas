import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GlyphOutline } from '../font/glyph-outline.js';

import { loadShaper } from './shaper.js';

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);

type Point = readonly [number, number];
type PenOperation = readonly [string, readonly Point[]];

interface Reference {
  readonly unitsPerEm: number;
  readonly glyphs: Readonly<Record<string, { glyphId: number; outline: readonly PenOperation[] }>>;
}

function referenceContours(operations: readonly PenOperation[]): Point[][] {
  const contours: Point[][] = [];
  for (const [operator, points] of operations) {
    if (operator === 'moveTo') contours.push([]);
    const contour = contours.at(-1);
    if (contour === undefined || points.length === 0) continue;
    if (operator === 'qCurveTo') {
      for (let index = 0; index + 2 < points.length; index += 1) {
        const [ax, ay] = points[index] ?? [0, 0];
        const [bx, by] = points[index + 1] ?? [0, 0];
        contour.push([(ax + bx) / 2, (ay + by) / 2]);
      }
    }
    const last = points.at(-1);
    if (last !== undefined) contour.push(last);
  }
  return contours;
}

function open(points: readonly Point[]): readonly Point[] {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 1 && first?.[0] === last?.[0] && first?.[1] === last?.[1]
    ? points.slice(0, -1)
    : points;
}

function sameLoop(a: readonly Point[], b: readonly Point[], tolerance: number): boolean {
  const left = open(a);
  const right = open(b);
  if (left.length !== right.length) return false;
  if (left.length === 0) return true;
  return left.some((unused, offset) =>
    left.every(([x, y], index) => {
      const [rx, ry] = right[(index + offset) % right.length] ?? [Number.NaN, Number.NaN];
      return Math.abs(x - rx) <= tolerance && Math.abs(y - ry) <= tolerance;
    }),
  );
}

function drawnContours(outline: GlyphOutline, em: number): Point[][] {
  return outline.contours.map((contour) =>
    contour.map(({ x1, y1 }) => [x1 * em, y1 * em] as const),
  );
}

describe.each(['corpus-sans-regular', 'corpus-sans-bold', 'corpus-serif-regular'])(
  'Shaper.outline for %s',
  (name) => {
    const reference = JSON.parse(
      readFileSync(new URL(`${name}.reference.json`, CORPUS), 'utf8'),
    ) as Reference;

    it.each(['ttf', 'cff.otf', 'cff2.otf'])(
      'draws %s contours through the reference on-curve points, in em and y up',
      async (format) => {
        const bytes = new Uint8Array(readFileSync(new URL(`${name}.${format}`, CORPUS)));
        const shaper = await loadShaper();
        const face = shaper.face(`${name}.${format}`, bytes);
        expect(face.unitsPerEm).toBe(reference.unitsPerEm);

        for (const character of ['A', 'o', 'g', ' ', 'é']) {
          const glyph = reference.glyphs[character];
          if (glyph === undefined) throw new Error(`No reference for ${character}`);
          const outline = shaper.outline(face, glyph.glyphId);
          const expected = referenceContours(glyph.outline);
          const drawn = drawnContours(outline, face.unitsPerEm);
          expect(drawn.length, character).toBe(expected.length);
          for (const contour of outline.contours) {
            expect(contour.length, character).toBeGreaterThan(0);
            const first = contour[0];
            const last = contour.at(-1);
            expect(last?.x1, character).toBeCloseTo(first?.x0 ?? Number.NaN, 9);
            expect(last?.y1, character).toBeCloseTo(first?.y0 ?? Number.NaN, 9);
            for (let index = 1; index < contour.length; index += 1) {
              expect(contour[index]?.x0).toBeCloseTo(contour[index - 1]?.x1 ?? Number.NaN, 9);
              expect(contour[index]?.y0).toBeCloseTo(contour[index - 1]?.y1 ?? Number.NaN, 9);
            }
          }
          for (const loop of expected) {
            expect(
              drawn.some((candidate) => sameLoop(candidate, loop, format === 'ttf' ? 1e-6 : 0.5)),
              `${character}: reference contour`,
            ).toBe(true);
          }
          if (format !== 'ttf' && character === 'o') {
            expect(outline.contours.flat().some((segment) => segment.kind === 'cubic')).toBe(true);
          }
        }
      },
    );
  },
);

it('returns empty outlines for an out-of-range glyph and an unreadable face', async () => {
  const shaper = await loadShaper();
  const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-regular.ttf', CORPUS)));
  const face = shaper.face('out-of-range-acceptance', bytes);
  expect(shaper.outline(face, 1_000_000)).toEqual({ contours: [] });
  const unreadable = shaper.face('unreadable-outline-acceptance', bytes.slice(0, 12));
  expect(shaper.outline(unreadable, 1)).toEqual({ contours: [] });
});
