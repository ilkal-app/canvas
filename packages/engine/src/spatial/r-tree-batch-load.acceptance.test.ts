import { describe, expect, it } from 'vitest';

import { randomBox, randomEntries, seededRandom } from './__fixtures__/random-boxes.js';
import { intersectsBounds } from './bounds.js';
import { RTree, type RTreeEntry } from './r-tree.js';

/**
 * Sorts query results because an R-tree does not promise traversal order.
 *
 * @param keys - Search results.
 * @returns Keys in lexical order.
 */
function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

/**
 * Gives the second batch distinct keys while preserving the seeded fixture's boxes.
 *
 * @param count - Number of entries.
 * @param seed - Deterministic fixture seed.
 * @returns Entries whose keys do not overlap the first batch.
 */
function laterEntries(count: number, seed: number): RTreeEntry<string>[] {
  return randomEntries(count, seed).map(({ key, bounds }) => ({ key: `later-${key}`, bounds }));
}

/**
 * Compares seeded rectangle queries with a scan of every stored box.
 *
 * @param tree - Index under test.
 * @param entries - Complete set of expected boxes.
 */
function expectQueries(tree: RTree<string>, entries: readonly RTreeEntry<string>[]): void {
  const random = seededRandom(529);
  for (let index = 0; index < 30; index += 1) {
    const query = randomBox(random, 10_000, 1_500);
    const expected = entries
      .filter(({ bounds }) => intersectsBounds(bounds, query))
      .map(({ key }) => key);
    expect(sorted(tree.searchRect(query))).toEqual(sorted(expected));
  }
}

describe('RTree bulk load acceptance', () => {
  it('reports one level for an empty tree and a leaf root', () => {
    const tree = new RTree<string>();
    expect(tree.height).toBe(1);
    tree.bulkLoad(randomEntries(16, 1));
    expect(tree.height).toBe(1);
    tree.clear();
    expect(tree.height).toBe(1);
  });

  it('repacks a non-empty tree when the incoming batch is at least its current size', () => {
    const first = randomEntries(1_000, 2);
    // At 4,000 entries STR needs three levels; incremental splits grow this fixture to four.
    const later = laterEntries(3_000, 3);
    const all = [...first, ...later];
    const incremental = new RTree<string>();
    incremental.bulkLoad(first);
    incremental.bulkLoad(later);
    const fresh = new RTree<string>();
    fresh.bulkLoad(all);

    expect(incremental.size).toBe(all.length);
    expect(incremental.validate()).toEqual([]);
    for (const { key, bounds } of all) expect(incremental.boundsOf(key)).toEqual(bounds);
    expectQueries(incremental, all);
    expect(incremental.height).toBe(3);
    expect(fresh.height).toBe(3);
    expect(incremental.height).toBe(fresh.height);
  });

  it('rejects duplicate keys and invalid boxes before changing an existing tree', () => {
    const first = randomEntries(20, 4);
    const tree = new RTree<string>();
    tree.bulkLoad(first);
    const originalBounds = tree.bounds;
    const valid = laterEntries(20, 5);
    const existingKey = first[0]?.key;
    const newEntry = valid[0];
    if (existingKey === undefined || newEntry === undefined) throw new Error('Missing fixture');
    const bad: readonly RTreeEntry<string>[][] = [
      [...valid, { key: existingKey, bounds: newEntry.bounds }],
      [...valid, { key: newEntry.key, bounds: newEntry.bounds }],
      [...valid, { key: 'nan', bounds: { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 } }],
      [...valid, { key: 'inverted', bounds: { minX: 2, minY: 0, maxX: 1, maxY: 1 } }],
    ];
    for (const entries of bad) {
      expect(() => {
        tree.bulkLoad(entries);
      }).toThrow(RangeError);
      expect(tree.size).toBe(first.length);
      expect(tree.bounds).toEqual(originalBounds);
      expect(tree.validate()).toEqual([]);
      for (const { key, bounds } of first) expect(tree.boundsOf(key)).toEqual(bounds);
      expect(tree.boundsOf(newEntry.key)).toBeUndefined();
    }
  });
});
