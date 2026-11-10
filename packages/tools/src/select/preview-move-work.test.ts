import { expect, it } from 'vitest';

import { worldTransformOf } from '@canvas/engine';
import { applyTransform, invertTransform, type BoardObject, type ObjectId } from '@canvas/schema';

import { group, id, rect } from './__fixtures__/select-board.js';
import { previewObjects } from './transform-plan.js';

it('reads the immutable parent transform once per moved object and preserves exact arithmetic', () => {
  const parent = group('parent', null, 1e12 + 0.125, -1e10, 0.12345);
  const child = rect('child', 'parent', { x: 0.3, y: -0.7, width: 10, height: 20 });
  const objects = new Map<ObjectId, BoardObject>([
    [parent.id, parent],
    [child.id, child],
  ]);
  let parentReads = 0;
  const source = {
    get(objectId: ObjectId) {
      if (objectId === parent.id) parentReads++;
      return objects.get(objectId);
    },
    childrenOf: () => [],
  };
  const delta = { x: 0.125, y: 0.25 };
  const transform = worldTransformOf(parent, source);
  const origin = applyTransform(transform, { x: child.x, y: child.y });
  const expected = applyTransform(invertTransform(transform), {
    x: origin.x + delta.x,
    y: origin.y + delta.y,
  });
  parentReads = 0;
  const preview = previewObjects(
    { kind: 'move', ids: [id('missing'), child.id, child.id], delta },
    source,
  );
  expect(preview).toEqual([
    { ...child, ...expected },
    { ...child, ...expected },
  ]);
  expect(preview[0]).not.toBe(child);
  expect(parentReads).toBe(2);
  expect(child.x).toBe(0.3);
});
