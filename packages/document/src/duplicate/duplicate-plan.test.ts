import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { planDuplicate } from './duplicate-plan.js';

describe('planDuplicate', () => {
  it('keeps duplicates in the originals’ shared parent, 16 world units away in the parent’s frame', () => {
    const plan = planDuplicate(clipboardBoard(), ['left', 'right'] as ObjectId[]);
    expect(plan?.parentId).toBe('group');
    // The group is turned a quarter turn on the board: 16 across and down there is (16, −16) in it.
    const [left, right] = plan?.objects ?? [];
    expect(left?.x).toBeCloseTo(16, 9);
    expect(left?.y).toBeCloseTo(-16, 9);
    expect(left?.rotation).toBeCloseTo(0, 9);
    expect(right?.x).toBeCloseTo(76, 9);
  });

  it('puts duplicates of objects from different parents at the root', () => {
    const plan = planDuplicate(clipboardBoard(), ['left', 'outside'] as ObjectId[]);
    expect(plan?.parentId).toBeNull();
    expect(plan?.objects.find(({ id }) => id === 'outside')).toMatchObject({ x: 16, y: 16 });
  });

  it('moves duplicates by an offset given in board units', () => {
    const plan = planDuplicate(clipboardBoard(), ['outside'] as ObjectId[], { x: 300, y: -40 });
    const original = clipboardBoard().objects.get('outside' as ObjectId);
    expect(plan?.objects[0]).toMatchObject({
      x: (original?.x ?? NaN) + 300,
      y: (original?.y ?? NaN) - 40,
    });
  });

  it('plans nothing when nothing selected can be copied', () => {
    expect(planDuplicate(clipboardBoard(), ['pin'] as ObjectId[])).toBeUndefined();
  });
});
