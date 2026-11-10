import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ArrangeBox } from './arrange-box.js';
import { ALIGN_KINDS, planAlign } from './plan-align.js';

function box(id: string, x: number, y: number, width: number, height: number): ArrangeBox {
  return { id: id as ObjectId, x, y, width, height };
}

// Three boxes of different sizes: bounds x 0–300, y 0–200.
const BOXES = [box('a', 0, 20, 100, 50), box('b', 150, 0, 50, 100), box('c', 260, 120, 40, 80)];

describe('planAlign', () => {
  it.each([
    [
      'left',
      [
        ['b', -150, 0],
        ['c', -260, 0],
      ],
    ],
    [
      'centre',
      [
        ['a', 100, 0],
        ['b', -25, 0],
        ['c', -130, 0],
      ],
    ],
    [
      'right',
      [
        ['a', 200, 0],
        ['b', 100, 0],
      ],
    ],
    [
      'top',
      [
        ['a', 0, -20],
        ['c', 0, -120],
      ],
    ],
    [
      'middle',
      [
        ['a', 0, 55],
        ['b', 0, 50],
        ['c', 0, -60],
      ],
    ],
    [
      'bottom',
      [
        ['a', 0, 130],
        ['b', 0, 100],
      ],
    ],
  ] as const)('%s lines the boxes up on that edge of their bounds', (kind, expected) => {
    expect(planAlign(kind, BOXES)).toEqual(expected.map(([id, x, y]) => ({ id, delta: { x, y } })));
  });

  it('aligns to an anchor instead of the bounds when given one', () => {
    const anchor = { x: 0, y: 0, width: 900, height: 560 };
    expect(planAlign('right', [box('a', 10, 10, 70, 60)], anchor)).toEqual([
      { id: 'a', delta: { x: 820, y: 0 } },
    ]);
    expect(planAlign('middle', [box('a', 10, 10, 70, 60)], anchor)).toEqual([
      { id: 'a', delta: { x: 0, y: 240 } },
    ]);
  });

  it('moves nothing for one box without an anchor, or for no boxes', () => {
    expect(planAlign('left', [box('a', 10, 10, 70, 60)])).toEqual([]);
    expect(planAlign('centre', [])).toEqual([]);
  });

  it('never changes its input', () => {
    const boxes = BOXES.map((each) => Object.freeze({ ...each }));
    planAlign('bottom', Object.freeze(boxes));
    expect(boxes).toEqual(BOXES);
  });

  it('lists the six alignments', () => {
    expect(ALIGN_KINDS).toEqual(['left', 'centre', 'right', 'top', 'middle', 'bottom']);
  });
});
