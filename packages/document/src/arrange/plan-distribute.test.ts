import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ArrangeBox } from './arrange-box.js';
import { planDistribute } from './plan-distribute.js';

function box(id: string, x: number, y: number, width: number, height: number): ArrangeBox {
  return { id: id as ObjectId, x, y, width, height };
}

/**
 * The same box with its axes swapped, for the vertical cases.
 *
 * @param box - The box.
 * @returns The box mirrored in the diagonal.
 */
function transposed(box: ArrangeBox): ArrangeBox {
  return { id: box.id, x: box.y, y: box.x, width: box.height, height: box.width };
}

// Uneven sizes, listed out of order: a 0–100, b 130–170, c 200–250, d 400–500. Widths sum to 290
// over a span of 500, so the three gaps become 70 each: b at 170, c at 280.
const ROW = [
  box('c', 200, 5, 50, 10),
  box('a', 0, 0, 100, 30),
  box('d', 400, 40, 100, 20),
  box('b', 130, 10, 40, 40),
];

describe('planDistribute', () => {
  it('equalises the gaps between neighbours horizontally, the outer two staying put', () => {
    expect(planDistribute('horizontal', ROW)).toEqual([
      { id: 'c', delta: { x: 80, y: 0 } },
      { id: 'b', delta: { x: 40, y: 0 } },
    ]);
  });

  it('equalises the gaps vertically', () => {
    expect(planDistribute('vertical', ROW.map(transposed))).toEqual([
      { id: 'c', delta: { x: 0, y: 80 } },
      { id: 'b', delta: { x: 0, y: 40 } },
    ]);
  });

  it('orders by centre, so a wide box starting first can sit in the middle', () => {
    // wide's centre (150) lies between a's (25) and b's (275).
    const boxes = [box('a', 0, 0, 50, 10), box('wide', -20, 0, 340, 10), box('b', 250, 0, 50, 10)];
    // Span 0–300 holds 440 of widths, so the gaps are −70 each: wide starts at −20.
    expect(planDistribute('horizontal', boxes)).toEqual([]);
  });

  it('keeps the input order between boxes with the same centre', () => {
    const boxes = [box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10), box('c', 50, 0, 10, 10)];
    // a and c are the outer two; b goes midway: 25.
    expect(planDistribute('horizontal', boxes)).toEqual([{ id: 'b', delta: { x: -25, y: 0 } }]);
  });

  it('needs three boxes or more', () => {
    expect(planDistribute('horizontal', ROW.slice(0, 2))).toEqual([]);
    expect(planDistribute('horizontal', ROW.slice(0, 1))).toEqual([]);
    expect(planDistribute('vertical', [])).toEqual([]);
  });

  it('never changes its input', () => {
    const boxes = ROW.map((each) => Object.freeze({ ...each }));
    planDistribute('horizontal', Object.freeze(boxes));
    expect(boxes).toEqual(ROW);
  });
});
