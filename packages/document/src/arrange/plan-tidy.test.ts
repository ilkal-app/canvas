import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ArrangeBox } from './arrange-box.js';
import { planTidy } from './plan-tidy.js';

function box(id: string, x: number, y: number, width: number, height: number): ArrangeBox {
  return { id: id as ObjectId, x, y, width, height };
}

/**
 * Where each box ends up after the plan's moves.
 *
 * @param boxes - The boxes.
 * @returns Each box's top-left corner after the moves, by id.
 */
function placed(boxes: readonly ArrangeBox[]): Record<string, [number, number]> {
  const moves = new Map(planTidy(boxes).map(({ id, delta }) => [id, delta]));
  return Object.fromEntries(
    boxes.map(({ id, x, y }) => {
      const delta = moves.get(id) ?? { x: 0, y: 0 };
      return [id, [x + delta.x, y + delta.y]];
    }),
  );
}

// A scrambled 3 × 3 of 70 × 60 boxes, listed out of order. Reading order finds the rows
// A B C / D E F / G H I. The gaps between neighbours in a row are 25, 20; 28, 16; 14, 32 and
// between rows 7 and 10, so the median gap is 18; the grid starts at the bounds' corner (−6, −5)
// with cells 70 + 18 across and 60 + 18 down.
const SCRAMBLED = [
  box('E', 92, 75, 70, 60),
  box('I', 190, 158, 70, 60),
  box('A', 0, 0, 70, 60),
  box('G', 4, 160, 70, 60),
  box('C', 185, -5, 70, 60),
  box('F', 178, 88, 70, 60),
  box('B', 95, 8, 70, 60),
  box('H', 88, 170, 70, 60),
  box('D', -6, 82, 70, 60),
];

describe('planTidy', () => {
  it('arranges a scrambled 3 × 3 into a grid in reading order, spaced by the median gap', () => {
    expect(placed(SCRAMBLED)).toEqual({
      A: [-6, -5],
      B: [82, -5],
      C: [170, -5],
      D: [-6, 73],
      E: [82, 73],
      F: [170, 73],
      G: [-6, 151],
      H: [82, 151],
      I: [170, 151],
    });
  });

  it('sizes each column by its widest box and each row by its tallest', () => {
    // b overlaps a's rows, so a and b are one row; c lies wholly below them. Gaps 50 and 30:
    // the median is 40. Column 0 is 100 wide (a), row 0 is 80 tall (b).
    const boxes = [box('a', 0, 0, 100, 40), box('b', 150, 10, 50, 80), box('c', 20, 120, 60, 30)];
    expect(placed(boxes)).toEqual({ a: [0, 0], b: [140, 0], c: [0, 120] });
    expect(planTidy(boxes).map(({ id }) => id)).toEqual(['b', 'c']);
  });

  it('closes overlaps: a negative median gap spaces the grid by 0', () => {
    const boxes = [box('a', 0, 0, 50, 50), box('b', 30, 0, 50, 50)];
    expect(placed(boxes)).toEqual({ a: [0, 0], b: [50, 0] });
  });

  it('moves nothing for fewer than two boxes, or for a grid already tidy', () => {
    expect(planTidy([box('a', 5, 5, 10, 10)])).toEqual([]);
    expect(planTidy([])).toEqual([]);
    const tidy = [box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 10), box('c', 0, 20, 10, 10)];
    expect(planTidy(tidy)).toEqual([]);
  });

  it('never changes its input', () => {
    const boxes = SCRAMBLED.map((each) => Object.freeze({ ...each }));
    planTidy(Object.freeze(boxes));
    expect(boxes).toEqual(SCRAMBLED);
  });
});
