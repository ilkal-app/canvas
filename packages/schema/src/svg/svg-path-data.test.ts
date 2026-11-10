import { describe, expect, it } from 'vitest';

import type { Point } from '../fields/point.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';
import { arcToPieces, readPathData } from './svg-path-data.js';

const line = (x: number, y: number): OutlinePiece => ({ kind: 'line', to: { x, y } });

function cubicAt(from: Point, piece: OutlinePiece, t: number): Point {
  if (piece.kind === 'line') throw new Error('not a cubic');
  const s = 1 - t;
  const blend = (p0: number, p1: number, p2: number, p3: number): number =>
    s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
  return {
    x: blend(from.x, piece.c1.x, piece.c2.x, piece.to.x),
    y: blend(from.y, piece.c1.y, piece.c2.y, piece.to.y),
  };
}

/**
 * Samples every cubic of an arc and returns the distances from a centre.
 *
 * @param from - The arc's start.
 * @param pieces - Its cubics.
 * @param centre - The centre to measure from.
 * @returns The distances, three per cubic.
 */
function radiiAlong(from: Point, pieces: readonly OutlinePiece[], centre: Point): number[] {
  const radii: number[] = [];
  let start = from;
  for (const piece of pieces) {
    for (const t of [0.25, 0.5, 0.75]) {
      const point = cubicAt(start, piece, t);
      radii.push(Math.hypot(point.x - centre.x, point.y - centre.y));
    }
    start = piece.to;
  }
  return radii;
}

function only(data: string): Subpath {
  const { subpaths, error } = readPathData(data);
  expect(error).toBeUndefined();
  const [subpath, ...rest] = subpaths;
  expect(rest).toEqual([]);
  if (subpath === undefined) throw new Error('no subpath');
  return subpath;
}

describe('readPathData', () => {
  it('reads absolute and relative lines, with implicit repeats', () => {
    expect(only('M10 10 L20 10 H30 V20 l-5 5 h-5 v-5 z')).toEqual({
      start: { x: 10, y: 10 },
      isClosed: true,
      pieces: [line(20, 10), line(30, 10), line(30, 20), line(25, 25), line(20, 25), line(20, 20)],
    });
    expect(only('M0 0 10 0 10 10').pieces).toEqual([line(10, 0), line(10, 10)]);
    expect(only('m5 5 10 0 0 10').pieces).toEqual([line(15, 5), line(15, 15)]);
  });

  it('reads compact numbers: signs, leading dots, exponents and flags without separators', () => {
    expect(only('M.5.5L1e1-2E0').pieces).toEqual([line(10, -2)]);
    expect(only('M0,0l+1-1.5.5.5').pieces).toEqual([line(1, -1.5), line(1.5, -1)]);
    const arc = only('M0 0a5 5 0 1010 0').pieces;
    expect(arc.at(-1)?.to).toEqual({ x: 10, y: 0 });
  });

  it('reads cubics and smooth cubics, reflecting the previous control point', () => {
    const { pieces } = only('M0 0 C0 10 10 10 10 0 S20 -10 20 0 s10 10 10 0');
    expect(pieces).toEqual([
      { kind: 'cubic', c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
      { kind: 'cubic', c1: { x: 10, y: -10 }, c2: { x: 20, y: -10 }, to: { x: 20, y: 0 } },
      { kind: 'cubic', c1: { x: 20, y: 10 }, c2: { x: 30, y: 10 }, to: { x: 30, y: 0 } },
    ]);
    // Without a cubic before it, S's first control point is the current point.
    expect(only('M0 0 L5 0 S10 10 10 0').pieces[1]).toEqual({
      kind: 'cubic',
      c1: { x: 5, y: 0 },
      c2: { x: 10, y: 10 },
      to: { x: 10, y: 0 },
    });
  });

  it('turns quadratics and smooth quadratics into exact cubics', () => {
    const { pieces } = only('M0 0 Q15 15 30 0 T60 0 t30 0');
    expect(pieces[0]).toEqual({
      kind: 'cubic',
      c1: { x: 10, y: 10 },
      c2: { x: 20, y: 10 },
      to: { x: 30, y: 0 },
    });
    // T reflects the control point (15, 15) about (30, 0) to (45, -15).
    expect(pieces[1]).toEqual({
      kind: 'cubic',
      c1: { x: 40, y: -10 },
      c2: { x: 50, y: -10 },
      to: { x: 60, y: 0 },
    });
    expect(pieces[2]).toMatchObject({ c1: { x: 70, y: 10 }, to: { x: 90, y: 0 } });
    // Without a quadratic before it, T's control point is the current point: a straight cubic.
    expect(only('M0 0 T30 0').pieces[0]).toEqual({
      kind: 'cubic',
      c1: { x: 0, y: 0 },
      c2: { x: 10, y: 0 },
      to: { x: 30, y: 0 },
    });
  });

  it('starts a new subpath at each moveto and after a closepath continues from its start', () => {
    const { subpaths } = readPathData('M0 0 L10 0 M20 20 L30 20 Z l5 5 M40 40 M50 50 Z');
    expect(subpaths).toEqual([
      { start: { x: 0, y: 0 }, isClosed: false, pieces: [line(10, 0)] },
      { start: { x: 20, y: 20 }, isClosed: true, pieces: [line(30, 20)] },
      { start: { x: 20, y: 20 }, isClosed: false, pieces: [line(25, 25)] },
    ]);
  });

  it('keeps what came before an error and reports the error', () => {
    expect(readPathData('M0 0 L10 0 L20')).toEqual({
      subpaths: [{ start: { x: 0, y: 0 }, isClosed: false, pieces: [line(10, 0)] }],
      error: 'command "L" is missing numbers at offset 14',
    });
    expect(readPathData('M0 0 L10 0 Z 5').error).toBe('unexpected "5" at offset 13');
    expect(readPathData('L10 0').error).toBe(
      'path data must start with a moveto, not "L", at offset 0',
    );
    expect(readPathData('  l10 0').error).toBe(
      'path data must start with a moveto, not "l", at offset 2',
    );
    expect(readPathData('10 0').error).toBe('unexpected "1" at offset 0');
    expect(readPathData('M0 0 A1 1 0 2 1 5 5').error).toMatch(/^command "A" is missing/);
    expect(readPathData('M0 0 X').error).toBe('unexpected "X" at offset 5');
    expect(readPathData('')).toEqual({ subpaths: [], error: undefined });
  });
});

describe('arcToPieces', () => {
  it('draws a half circle as two quarter-turn cubics on the circle', () => {
    const from = { x: 0, y: 0 };
    const pieces = arcToPieces(from, { x: 10, y: 10 }, 0, false, true, { x: 20, y: 0 });
    expect(pieces).toHaveLength(2);
    for (const radius of radiiAlong(from, pieces, { x: 10, y: 0 })) {
      expect(radius).toBeCloseTo(10, 1);
    }
    // Sweep 1 turns clockwise on screen (y down): from the left end over the top.
    expect(pieces[0]?.to.y).toBeCloseTo(-10, 9);
    expect(
      arcToPieces(from, { x: 10, y: 10 }, 0, false, false, { x: 20, y: 0 })[0]?.to.y,
    ).toBeCloseTo(10, 9);
  });

  it('picks the large or small arc and scales radii that are too small', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 0 };
    const small = arcToPieces(from, { x: 10, y: 10 }, 0, false, true, to);
    const large = arcToPieces(from, { x: 10, y: 10 }, 0, true, true, to);
    expect(small).toHaveLength(1);
    expect(large).toHaveLength(4);
    const scaled = arcToPieces(from, { x: 1, y: 1 }, 0, false, true, to);
    expect(radiiAlong(from, scaled, { x: 5, y: 0 }).every((r) => Math.abs(r - 5) < 0.01)).toBe(
      true,
    );
  });

  it('rotates the ellipse by its x-axis rotation', () => {
    const from = { x: 0, y: 0 };
    const pieces = arcToPieces(from, { x: 20, y: 10 }, 90, false, true, { x: 0, y: 40 });
    // Rotated 90°, the long axis is vertical: the ends are its two tips, the centre (0, 20).
    let start = from;
    for (const piece of pieces) {
      const mid = cubicAt(start, piece, 0.5);
      const u = (mid.y - 20) / 20;
      const v = mid.x / 10;
      expect(u * u + v * v).toBeCloseTo(1, 2);
      start = piece.to;
    }
  });

  it('draws nothing for equal ends and a line for a zero radius', () => {
    const at = { x: 3, y: 4 };
    expect(arcToPieces(at, { x: 5, y: 5 }, 0, false, false, at)).toEqual([]);
    expect(arcToPieces(at, { x: 0, y: 5 }, 0, false, false, { x: 9, y: 9 })).toEqual([line(9, 9)]);
    expect(arcToPieces(at, { x: -5, y: -5 }, 0, false, true, { x: 13, y: 4 })).toHaveLength(2);
  });
});
