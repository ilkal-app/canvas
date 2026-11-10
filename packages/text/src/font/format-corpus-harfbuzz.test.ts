import { readFileSync } from 'node:fs';

import type * as HarfBuzzModule from 'harfbuzzjs';
import { beforeAll, describe, expect, it } from 'vitest';

type HarfBuzz = typeof HarfBuzzModule;

/** The font-format corpus, built by tooling/fonts/build-format-corpus.py. */
const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);

/** One fontTools RecordingPen operation: its name and points, font units. */
type PenOperation = readonly [string, readonly (readonly [number, number])[]];

/** What fontTools read from a corpus face's TrueType version. */
interface Reference {
  readonly glyphs: Readonly<Record<string, { glyphId: number; outline: readonly PenOperation[] }>>;
}

/** A glyph's contours as their on-curve points, in drawing order, font units. */
type OnCurveContours = readonly (readonly (readonly [number, number])[])[];

/**
 * The on-curve points of fontTools' outline, contour by contour. A `qCurveTo` with several
 * off-curve points is TrueType's run of quadratic curves, each ending at the midpoint of two
 * off-curve points (implied) and the last at its on-curve point: the points every drawer, and
 * the CFF versions' cubic curves, pass through.
 *
 * @param outline - The recorded operations.
 * @returns The contours.
 */
function referenceContours(outline: readonly PenOperation[]): OnCurveContours {
  const contours: [number, number][][] = [];
  for (const [operator, points] of outline) {
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
    if (last !== undefined) contour.push([last[0], last[1]]);
  }
  return contours;
}

let hb: HarfBuzz;

beforeAll(async () => {
  hb = await import('harfbuzzjs');
});

/**
 * HarfBuzz's on-curve points of a glyph, contour by contour.
 *
 * @param bytes - The font file.
 * @param faceIndex - The face of a collection; 0 otherwise.
 * @param glyph - The glyph id.
 * @returns The contours.
 */
function harfbuzzContours(bytes: Uint8Array, faceIndex: number, glyph: number): OnCurveContours {
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes.slice().buffer), faceIndex));
  const contours: [number, number][][] = [];
  const funcs = new hb.DrawFuncs();
  const add = (x: number, y: number): void => {
    contours.at(-1)?.push([x, y]);
  };
  funcs.setMoveToFunc((x, y) => {
    contours.push([[x, y]]);
  });
  funcs.setLineToFunc(add);
  funcs.setQuadraticToFunc((cx, cy, x, y) => {
    add(x, y);
  });
  funcs.setCubicToFunc((c1x, c1y, c2x, c2y, x, y) => {
    add(x, y);
  });
  funcs.setClosePathFunc(() => undefined);
  font.drawGlyph(glyph, funcs);
  return contours;
}

/**
 * A contour without its closing point (fontTools repeats the start; HarfBuzz may not).
 *
 * @param contour - The contour.
 * @returns It, open.
 */
function open(contour: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const [first] = contour;
  const last = contour.at(-1);
  return contour.length > 1 && first?.[0] === last?.[0] && first?.[1] === last?.[1]
    ? contour.slice(0, -1)
    : [...contour];
}

/**
 * Whether two contours are the same closed loop, whichever point each starts at, each point
 * within a tolerance.
 *
 * @param a - One contour.
 * @param b - The other.
 * @param tolerance - The largest difference of a coordinate, font units.
 * @returns `true` when one is a rotation of the other.
 */
function isSameLoop(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
  tolerance: number,
): boolean {
  const left = open(a);
  const right = open(b);
  if (left.length !== right.length) return false;
  return left.some((unused, offset) =>
    left.every(([x, y], index) => {
      const [rx, ry] = right[(index + offset) % right.length] ?? [Number.NaN, Number.NaN];
      return Math.abs(x - rx) <= tolerance && Math.abs(y - ry) <= tolerance;
    }),
  );
}

/**
 * How far a format's on-curve points may be from the TrueType reference: none for TrueType; half
 * a unit for CFF and CFF2, whose charstrings hold whole units, so an implied midpoint at .5 is
 * rounded when the face is converted.
 *
 * @param file - The corpus file.
 * @returns The tolerance, font units.
 */
function toleranceOf(file: string): number {
  return file.endsWith('.otf') ? 0.5 : 0;
}

// The faces of the collection, and the TrueType face each repeats.
const COLLECTION_FACES = [
  { faceIndex: 0, face: 'corpus-sans-regular' },
  { faceIndex: 1, face: 'corpus-sans-bold' },
];

describe.each([
  ...['corpus-sans-regular', 'corpus-sans-bold', 'corpus-serif-regular'].flatMap((face) =>
    ['ttf', 'cff.otf', 'cff2.otf'].map((format) => ({
      file: `${face}.${format}`,
      face,
      faceIndex: 0,
    })),
  ),
  ...COLLECTION_FACES.map(({ faceIndex, face }) => ({ file: 'corpus-sans.ttc', face, faceIndex })),
])("HarfBuzz's outlines of $file (face $faceIndex)", ({ file, face, faceIndex }) => {
  const reference = JSON.parse(
    readFileSync(new URL(`${face}.reference.json`, CORPUS), 'utf8'),
  ) as Reference;
  const bytes = new Uint8Array(readFileSync(new URL(file, CORPUS)));

  it.each(Object.entries(reference.glyphs))(
    "pass through fontTools' on-curve points of %j, contour by contour",
    (char, glyph) => {
      const expected = referenceContours(glyph.outline);
      const drawn = harfbuzzContours(bytes, faceIndex, glyph.glyphId);
      expect(drawn.length, char).toBe(expected.length);
      for (const contour of expected) {
        expect(
          drawn.some((candidate) => isSameLoop(candidate, contour, toleranceOf(file))),
          `${char}: a contour of ${String(contour.length)} points`,
        ).toBe(true);
      }
    },
  );
});
