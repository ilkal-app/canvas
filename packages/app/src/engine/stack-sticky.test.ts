// The note Shift+N stacks below the selected one: same parent, width, colour, size and
// alignment, an empty note of its aspect's height, 16 units below.
import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId, StickyObject } from '@canvas/schema';

import { STACK_GAP, stackedStickyOf } from './stack-sticky.js';

const STYLE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: 'ink',
  weight: 400,
  italic: false,
} as const;

/**
 * A sticky note to stack below.
 *
 * @param fields - Fields to change.
 * @returns The note.
 */
function note(fields: Partial<StickyObject> = {}): StickyObject {
  return {
    id: 'above' as ObjectId,
    type: 'sticky',
    parentId: 'frame-1' as ObjectId,
    x: 100,
    y: 40,
    z: 'a0',
    rotation: 0,
    locked: true,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1,
    updatedAt: 1,
    width: 200,
    height: 260,
    text: 'Unclear owner',
    runs: [{ length: 13, style: STYLE }],
    align: 'left',
    autoWidth: false,
    verticalAlign: 'top',
    color: [1, 0.74, 0.8, 1],
    ...fields,
  };
}

describe('stackedStickyOf', () => {
  it('places an empty square note of the same look 16 units below', () => {
    const above = note();
    const below = stackedStickyOf(above);
    expect(below).toMatchObject({
      type: 'sticky',
      parentId: 'frame-1',
      x: 100,
      y: 40 + 260 + STACK_GAP,
      width: 200,
      height: 200,
      text: '',
      runs: [{ length: 0, style: STYLE }],
      align: 'left',
      verticalAlign: 'top',
      color: [1, 0.74, 0.8, 1],
      locked: false,
    });
    expect(below).not.toHaveProperty('aspect');
    expect(below.color).not.toBe(above.color);
    expect(STACK_GAP).toBe(16);
  });

  it('keeps a wide note wide and half as tall as it is wide', () => {
    const below = stackedStickyOf(note({ width: 400, height: 200, aspect: 'wide' }));
    expect(below).toMatchObject({ width: 400, height: 200, aspect: 'wide' });
  });
});

describe('stackedStickyOf on a rotated note', () => {
  it('places the note along the rotated down, keeping the rotation', () => {
    const below = stackedStickyOf(note({ rotation: Math.PI / 2, x: 0, y: 0, height: 200 }));
    // Rotated a quarter turn, the note's down points to the board's left.
    expect(below.x).toBeCloseTo(-(200 + STACK_GAP));
    expect(below.y).toBeCloseTo(0);
    expect(below.rotation).toBe(Math.PI / 2);
  });
});
