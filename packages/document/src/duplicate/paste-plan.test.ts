import { describe, expect, it } from 'vitest';

import { applyTransform, placementTransform, type Board, type ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { copySelection } from './copy-selection.js';
import { inParentFrame, PASTE_OFFSET, planPaste } from './paste-plan.js';

/**
 * Copies a selection of the fixture board.
 *
 * @param ids - The selected ids.
 * @returns The copy.
 * @throws {Error} When nothing was copied.
 */
function copyOf(...ids: string[]): Board {
  const copied = copySelection(clipboardBoard(), ids as ObjectId[]);
  if (copied === undefined) throw new Error('nothing was copied');
  return copied;
}

describe('planPaste', () => {
  it('lists parents before children and siblings bottom first, without keys or stamps', () => {
    const planned = planPaste(copyOf('photo', 'group', 'outside'), undefined);
    expect(planned.map(({ id }) => id)).toEqual(['group', 'left', 'right', 'outside', 'photo']);
    for (const object of planned) {
      for (const field of ['z', 'createdBy', 'createdAt', 'updatedAt']) {
        expect(object).not.toHaveProperty(field);
      }
    }
  });

  it('offsets the roots by 16 world units without a point, and leaves children alone', () => {
    const copied = copyOf('group', 'photo');
    const planned = planPaste(copied, undefined);
    const byId = new Map(planned.map((object) => [object.id, object]));
    const group = copied.objects.get('group' as ObjectId);
    expect(byId.get('group' as ObjectId)).toMatchObject({
      x: (group?.x ?? 0) + PASTE_OFFSET,
      y: (group?.y ?? 0) + PASTE_OFFSET,
    });
    expect(byId.get('photo' as ObjectId)).toMatchObject({ x: 316, y: 216 });
    expect(byId.get('left' as ObjectId)).toMatchObject({ x: 0, y: 0 });
  });

  it('centres the box around the roots on the point', () => {
    // The outside shape spans (0, 0)–(40, 20) and the photo (300, 200)–(460, 290): centre (230, 145).
    const planned = planPaste(copyOf('outside', 'photo'), { x: 1000, y: 1000 });
    expect(planned.map(({ x, y }) => [x, y])).toEqual([
      [770, 855],
      [1070, 1055],
    ]);
  });

  it('counts a turned root by its corners and a connector by its free ends', () => {
    // Turned a quarter turn about its origin, the group's children (0–100 × 0–20) cover
    // x −20…0 and y 0…100 around its origin.
    const group = planPaste(copyOf('group'), { x: 0, y: 0 })[0];
    expect(group?.x).toBeCloseTo(10, 9);
    expect(group?.y).toBeCloseTo(-50, 9);
    // A connector copied alone has both ends detached into free points.
    const copied = copyOf('link');
    const ends = [...copied.objects.values()].flatMap((object) =>
      object.type === 'connector' ? [object.from, object.to] : [],
    );
    const points = ends.flatMap((end) => (end.kind === 'point' ? [end] : []));
    expect(points).toHaveLength(2);
    const [first = { x: 0, y: 0 }, second = { x: 0, y: 0 }] = points;
    const link = planPaste(copied, { x: 0, y: 0 })[0];
    expect(link?.x).toBeCloseTo(-(Math.min(first.x, second.x) + Math.max(first.x, second.x)) / 2);
    expect(link?.y).toBeCloseTo(-(Math.min(first.y, second.y) + Math.max(first.y, second.y)) / 2);
  });

  it('leaves comments out', () => {
    const board = clipboardBoard();
    expect(planPaste(board, undefined).map(({ type }) => type)).not.toContain('comment');
  });
});

describe('inParentFrame', () => {
  it('re-expresses the roots in a parent frame so they stay where they are on the board', () => {
    const planned = planPaste(copyOf('outside', 'group'), undefined);
    const parent = placementTransform(1000, 0, Math.PI / 2);
    const moved = inParentFrame(planned, parent);
    for (const [index, object] of moved.entries()) {
      const before = planned[index];
      if (before === undefined) throw new Error('same length');
      if (before.parentId !== null) {
        expect(object).toBe(before);
        continue;
      }
      const onBoard = applyTransform(parent, { x: object.x, y: object.y });
      expect(onBoard.x).toBeCloseTo(before.x, 9);
      expect(onBoard.y).toBeCloseTo(before.y, 9);
      expect(object.rotation + Math.PI / 2).toBeCloseTo(before.rotation, 9);
    }
  });
});
