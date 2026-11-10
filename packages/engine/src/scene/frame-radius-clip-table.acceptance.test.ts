// The GPU clip record retains four radii for a nested rounded frame.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ClipRect } from '../spatial/clip-chain.js';

import { CLIP_FLOATS_PER_SLOT, ClipTable } from './clip-table.js';

function clip(
  id: string,
  cornerRadius: number | readonly [number, number, number, number],
): ClipRect {
  return { id: id as ObjectId, x: 0, y: 0, cos: 1, sin: 0, width: 100, height: 80, cornerRadius };
}

describe('rounded frame clip table', () => {
  it('stores four capped radii in top-left, top-right, bottom-right, bottom-left order', () => {
    const table = new ClipTable();
    const parent = clip('parent', 50);
    const parentSlot = table.set(parent, undefined, 0);
    const childSlot = table.set(clip('child', [1, 2, 100, 4]), parent, parentSlot);
    const record = Array.from(
      table.data.subarray(childSlot * CLIP_FLOATS_PER_SLOT, (childSlot + 1) * CLIP_FLOATS_PER_SLOT),
    );
    expect(
      record.some(
        (value, index) => value === 1 && record.slice(index, index + 4).join(',') === '1,2,40,4',
      ),
    ).toBe(true);
    expect(record[6]).toBe(parentSlot);
  });
});
