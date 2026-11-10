import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { dashPieces, polylineLength } from './dash-pieces.js';

// Cutting a polyline into the pieces its dashes draw.

const points = (...pairs: (readonly [number, number])[]): Point[] =>
  pairs.map(([x, y]) => ({ x, y }));

/** An L of two legs of 10: (0,0) → (10,0) → (10,10). */
const ELL = points([0, 0], [10, 0], [10, 10]);

/** A square of side 10, closed. */
const SQUARE = points([0, 0], [10, 0], [10, 10], [0, 10]);

describe('polylineLength', () => {
  it('measures open and closed polylines', () => {
    expect(polylineLength(ELL, false)).toBe(20);
    expect(polylineLength(SQUARE, true)).toBe(40);
    expect(polylineLength(SQUARE, false)).toBe(30);
  });
});

describe('dashPieces', () => {
  it('cuts along arc length across segments, keeping the corner inside a dash', () => {
    const pieces = dashPieces({ points: ELL }, false, [
      [0, 4],
      [8, 14],
      [18, 20],
    ]);
    expect(pieces).toEqual([
      {
        kind: 'piece',
        line: { points: points([0, 0], [4, 0]), corners: [false, false] },
        isAtStart: true,
        isAtEnd: false,
      },
      {
        kind: 'piece',
        line: { points: points([8, 0], [10, 0], [10, 4]), corners: [false, true, false] },
        isAtStart: false,
        isAtEnd: false,
      },
      {
        kind: 'piece',
        line: { points: points([10, 8], [10, 10]), corners: [false, false] },
        isAtStart: false,
        isAtEnd: true,
      },
    ]);
  });

  it('keeps the given corner flags, so a curve’s inner points join round', () => {
    const [piece] = dashPieces({ points: ELL, corners: [true, false, true] }, false, [[5, 15]]);
    expect(piece).toMatchObject({ line: { corners: [false, false, false] } });
  });

  it('turns a dash of length 0 into a dot along the stroke’s direction there', () => {
    expect(dashPieces({ points: ELL }, false, [[15, 15]])).toEqual([
      { kind: 'dot', point: { x: 10, y: 5 }, direction: { x: 0, y: 1 } },
    ]);
    // At the very end, the last segment's direction.
    expect(dashPieces({ points: ELL }, false, [[20, 20]])).toEqual([
      { kind: 'dot', point: { x: 10, y: 10 }, direction: { x: 0, y: 1 } },
    ]);
  });

  it('ends a dash exactly on a vertex at that vertex', () => {
    const [piece] = dashPieces({ points: ELL }, false, [[10, 10.5]]);
    expect(piece).toMatchObject({ line: { points: points([10, 0], [10, 0.5]) } });
    const [before] = dashPieces({ points: ELL }, false, [[2, 10]]);
    expect(before).toMatchObject({ line: { points: points([2, 0], [10, 0]) } });
  });

  it('joins the dash over a closed polyline’s closing point into one piece', () => {
    const pieces = dashPieces({ points: SQUARE }, true, [
      [0, 5],
      [15, 25],
      [35, 40],
    ]);
    expect(pieces).toEqual([
      {
        kind: 'piece',
        line: {
          points: points([0, 5], [0, 0], [5, 0]),
          corners: [false, true, false],
        },
        isAtStart: false,
        isAtEnd: false,
      },
      {
        kind: 'piece',
        line: { points: points([10, 5], [10, 10], [5, 10]), corners: [false, true, false] },
        isAtStart: false,
        isAtEnd: false,
      },
    ]);
  });

  it('leaves the pieces of a closed polyline apart where no dash runs over the close', () => {
    const pieces = dashPieces({ points: SQUARE }, true, [
      [1, 5],
      [30, 39],
    ]);
    expect(pieces.map((piece) => piece.kind === 'piece' && piece.isAtStart)).toEqual([
      false,
      false,
    ]);
    expect(pieces).toHaveLength(2);
    // One dash over the whole loop is left for the caller to draw closed.
    expect(dashPieces({ points: SQUARE }, true, [[0, 40]])).toHaveLength(1);
  });

  it('keeps a closed polyline’s pieces apart when its first or last dash is a dot, or none', () => {
    expect(dashPieces({ points: SQUARE }, true, [])).toEqual([]);
    const dotted = dashPieces({ points: SQUARE }, true, [
      [0, 0],
      [35, 40],
    ]);
    expect(dotted.map((piece) => piece.kind)).toEqual(['dot', 'piece']);
    const endingInDot = dashPieces({ points: SQUARE }, true, [
      [0, 5],
      [40, 40],
    ]);
    expect(endingInDot.map((piece) => piece.kind)).toEqual(['piece', 'dot']);
  });

  it('joins the closing dash at the first point with that point’s corner flag', () => {
    const [merged] = dashPieces({ points: SQUARE, corners: [false, true, true, true] }, true, [
      [0, 5],
      [35, 40],
    ]);
    expect(merged).toMatchObject({ line: { corners: [false, false, false] } });
  });

  it('does not mutate its input', () => {
    const line = { points: ELL, corners: [true, true, true] };
    const before = structuredClone(line);
    dashPieces(line, false, [[1, 12]]);
    expect(line).toEqual(before);
  });
});
