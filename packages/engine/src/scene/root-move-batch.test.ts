import { expect, it } from 'vitest';

import { shapeObject } from './__fixtures__/scene-objects.js';
import { getRootMoveBatch, withRootMoveBatch } from './root-move-batch.js';
import type { SceneChangeSet } from './scene-source.js';

it('exposes objects only inside collection and restores nested scopes after failure', () => {
  const first = shapeObject('first');
  const second = { ...first, x: 30 };
  const changes: SceneChangeSet = {
    created: [],
    updated: [first.id],
    deleted: [],
    get: () => first,
  };
  expect(getRootMoveBatch(changes)).toBeUndefined();
  const objects = [first];
  expect(
    withRootMoveBatch(changes, objects, () => {
      expect(getRootMoveBatch(changes)).toBe(objects);
      expect(() =>
        withRootMoveBatch(changes, [second], () => {
          expect(getRootMoveBatch(changes)).toEqual([second]);
          throw new Error('nested');
        }),
      ).toThrow('nested');
      expect(getRootMoveBatch(changes)).toBe(objects);
      return 42;
    }),
  ).toBe(42);
  expect(getRootMoveBatch(changes)).toBeUndefined();
  expect(changes.get(first.id)).toBe(first);
});
