import { expect, it, vi } from 'vitest';

import { randomBox, randomEntries, seededRandom } from './__fixtures__/random-boxes.js';
import { intersectsBounds } from './bounds.js';
import { RTree } from './r-tree.js';

it('refits a dense set of existing boxes without individual remove and insert operations', () => {
  const entries = randomEntries(1000, 17);
  const tree = new RTree<string>();
  tree.bulkLoad(entries);
  const remove = vi.spyOn(tree, 'remove');
  const insert = vi.spyOn(tree, 'insert');
  const changed = entries.slice(0, 800).map(({ key, bounds }) => ({
    key,
    bounds: {
      minX: bounds.minX + 1,
      maxX: bounds.maxX + 1,
      minY: bounds.minY + 2,
      maxY: bounds.maxY + 2,
    },
  }));
  tree.updateMany(changed);
  expect(remove).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(tree.validate()).toEqual([]);
  for (const entry of changed) expect(tree.boundsOf(entry.key)).toEqual(entry.bounds);
});

it('keeps exact query answers across dense movement, distant movement, deletion and recreation', () => {
  const entries = randomEntries(1000, 23);
  const tree = new RTree<string>();
  tree.bulkLoad(entries);
  const boxes = new Map(entries.map(({ key, bounds }) => [key, bounds]));
  const random = seededRandom(24);
  for (let step = 0; step < 12; step++) {
    const changed = entries
      .slice(0, 800)
      .map(({ key }) => ({ key, bounds: randomBox(random, step < 6 ? 10000 : 1e6, 200) }));
    tree.updateMany(changed);
    for (const { key, bounds } of changed) boxes.set(key, bounds);
    tree.remove('b950');
    boxes.delete('b950');
    const restored = randomBox(random, 10000, 300);
    tree.updateMany([{ key: 'b950', bounds: restored }]);
    boxes.set('b950', restored);
    expect(tree.validate()).toEqual([]);
    for (let query = 0; query < 25; query++) {
      const rect = randomBox(random, 1e6, 20000);
      const expected = [...boxes]
        .filter(([, bounds]) => intersectsBounds(bounds, rect))
        .map(([key]) => key)
        .sort();
      expect(tree.searchRect(rect).sort()).toEqual(expected);
    }
  }
});

it('copies only bounds fields and refuses invalid dense bounds before changing the tree', () => {
  const entries = randomEntries(100, 50);
  const tree = new RTree<string>();
  tree.bulkLoad(entries);
  const changed = entries.map(({ key, bounds }) => ({
    key,
    bounds: { ...bounds, key: 'must-not-replace-owned-key', minX: bounds.minX + 0.01 },
  }));
  tree.updateMany(changed);
  expect(tree.validate()).toEqual([]);
  const before = tree.bounds;
  expect(() => {
    tree.updateMany(
      changed.map((entry, index) =>
        index === 99
          ? { key: entry.key, bounds: { ...entry.bounds, minX: Number.NaN } }
          : { key: entry.key, bounds: { ...entry.bounds, minX: entry.bounds.minX + 0.01 } },
      ),
    );
  }).toThrow(RangeError);
  expect(tree.bounds).toEqual(before);
  expect(tree.validate()).toEqual([]);
});
