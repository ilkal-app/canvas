import { expect, it } from 'vitest';

import { shapeObject } from './__fixtures__/scene-objects.js';
import { worldTransformOf } from './world-transform.js';

it('does not allocate ancestor-cycle sets for a root or missing parent', () => {
  const original = globalThis.Set;
  let allocations = 0;
  const object = shapeObject('a', { x: -0, y: 2 ** 50, rotation: -0.7 });
  const root = { get: () => undefined };
  globalThis.Set = new Proxy(original, {
    construct(target, [values]) {
      allocations += 1;
      return new target(values as Iterable<unknown> | undefined);
    },
  });
  let direct;
  let missing;
  try {
    direct = worldTransformOf(object, root);
    missing = worldTransformOf({ ...object, parentId: shapeObject('missing').id }, root);
  } finally {
    globalThis.Set = original;
  }
  expect(direct).toEqual({ x: -0, y: 2 ** 50, cos: Math.cos(-0.7), sin: Math.sin(-0.7) });
  expect(missing).toEqual(direct);
  expect(allocations).toBe(0);
});
