import { expect, it } from 'vitest';

import { DenseTreeRefit, packTreeItems } from './dense-tree-refit.js';
import { itemOf, validateTree } from './r-tree-node.js';

it.each([0, 5])('repacks distant partial moves even with collinear boxes (height %s)', (height) => {
  const items = Array.from({ length: 128 }, (unused, key) =>
    itemOf(key, {
      minX: (key % 16) * 10,
      maxX: (key % 16) * 10 + 5,
      minY: height === 0 ? 0 : Math.floor(key / 16) * 10,
      maxY: height === 0 ? 0 : Math.floor(key / 16) * 10 + height,
    }),
  );
  const keyed = new Map(items.map((item) => [item.key, item]));
  const root = packTreeItems(items, 4);
  const refitter = new DenseTreeRefit<number>();
  const updates = items
    .filter((item) => item.key % 2 === 0)
    .map((item) => ({
      key: item.key,
      bounds: {
        minX: item.minX + 1e6,
        maxX: item.maxX + 1e6,
        minY: item.minY,
        maxY: item.maxY,
      },
    }));
  const packed = refitter.update(root, keyed, updates, 4);
  expect(packed).toBeDefined();
  expect(packed).not.toBe(root);
  if (packed === undefined) throw new Error('expected a repacked tree');
  expect(validateTree(packed, keyed, 2, 4)).toEqual([]);
  for (const { key, bounds } of updates) expect(keyed.get(key)).toEqual({ key, ...bounds });
});

it('leaves a sparse or new-key batch for ordinary insertion without mutating anything', () => {
  const items = Array.from({ length: 128 }, (unused, key) =>
    itemOf(key, { minX: key, maxX: key + 1, minY: 0, maxY: 1 }),
  );
  const keyed = new Map(items.map((item) => [item.key, item]));
  const root = packTreeItems(items, 4);
  const refitter = new DenseTreeRefit<number>();
  const before = JSON.stringify(root);
  expect(
    refitter.update(
      root,
      keyed,
      [{ key: 0, bounds: { minX: 100, maxX: 101, minY: 1, maxY: 2 } }],
      4,
    ),
  ).toBeUndefined();
  const updates = items.map((item) => ({
    key: item.key,
    bounds: { minX: 100, maxX: 101, minY: 1, maxY: 2 },
  }));
  updates.push({ key: 999, bounds: { minX: 100, maxX: 101, minY: 1, maxY: 2 } });
  expect(refitter.update(root, keyed, updates, 4)).toBeUndefined();
  expect(JSON.stringify(root)).toBe(before);
});
