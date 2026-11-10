import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';

import { randomBox, randomEntries, seededRandom } from './__fixtures__/random-boxes.js';
import { containsPoint, intersectsBounds } from './bounds.js';
import { RTree } from './r-tree.js';

// Every key whose box intersects the query, found by brute force: the oracle.
function bruteForce(boxes: ReadonlyMap<string, WorldBounds>, query: WorldBounds): string[] {
  return [...boxes].filter(([, bounds]) => intersectsBounds(bounds, query)).map(([key]) => key);
}

function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

function queriesAgree(tree: RTree<string>, boxes: ReadonlyMap<string, WorldBounds>, seed: number) {
  const random = seededRandom(seed);
  for (let index = 0; index < 50; index += 1) {
    const query = randomBox(random, 10_000, 1_500);
    expect(sorted(tree.searchRect(query))).toEqual(sorted(bruteForce(boxes, query)));
  }
}

describe('RTree', () => {
  it('finds nothing and has no bounds when empty', () => {
    const tree = new RTree<string>();
    expect(tree.size).toBe(0);
    expect(tree.bounds).toBeUndefined();
    expect(tree.searchRect({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 })).toEqual([]);
    expect(tree.validate()).toEqual([]);
  });

  it('answers rect queries like brute force after a bulk load of 5000 boxes', () => {
    const entries = randomEntries(5_000, 1);
    const tree = new RTree<string>();
    tree.bulkLoad(entries);
    expect(tree.size).toBe(5_000);
    expect(tree.validate()).toEqual([]);
    queriesAgree(tree, new Map(entries.map(({ key, bounds }) => [key, bounds])), 2);
  });

  it('keeps every node at least 40% full after bulk loads of awkward sizes', () => {
    for (const count of [1, 2, 15, 16, 17, 33, 100, 257, 1_000, 4_097]) {
      const tree = new RTree<string>();
      tree.bulkLoad(randomEntries(count, count));
      expect({ count, problems: tree.validate() }).toEqual({ count, problems: [] });
    }
  });

  it('answers rect queries like brute force after 3000 one-by-one inserts', () => {
    const tree = new RTree<string>();
    const boxes = new Map<string, WorldBounds>();
    for (const { key, bounds } of randomEntries(3_000, 3)) {
      tree.insert(key, bounds);
      boxes.set(key, bounds);
    }
    expect(tree.validate()).toEqual([]);
    queriesAgree(tree, boxes, 4);
  });

  it('stays correct through interleaved removes, moves and inserts', () => {
    const entries = randomEntries(2_000, 5);
    const tree = new RTree<string>();
    tree.bulkLoad(entries);
    const boxes = new Map(entries.map(({ key, bounds }) => [key, bounds]));
    const random = seededRandom(6);
    for (let step = 0; step < 3_000; step += 1) {
      const key = `b${String(Math.floor(random() * 2_500))}`;
      const roll = random();
      if (roll < 0.4 && boxes.has(key)) {
        expect(tree.remove(key)).toBe(true);
        boxes.delete(key);
      } else {
        const bounds = randomBox(random, 10_000, 100);
        tree.update(key, bounds);
        boxes.set(key, bounds);
      }
    }
    expect(tree.size).toBe(boxes.size);
    expect(tree.validate()).toEqual([]);
    queriesAgree(tree, boxes, 7);
  });

  it('stays sound while a deep tree of small nodes is taken apart and refilled', () => {
    // Capacity 4 makes a tree about seven levels deep, so removals dissolve inner nodes and put
    // whole subtrees back at their own level.
    const entries = randomEntries(3_000, 17);
    const tree = new RTree<string>({ maxEntries: 4 });
    tree.bulkLoad(entries);
    const boxes = new Map(entries.map(({ key, bounds }) => [key, bounds]));
    const random = seededRandom(18);
    const order = entries.map(({ key }) => key).sort(() => random() - 0.5);
    order.forEach((key, index) => {
      tree.remove(key);
      boxes.delete(key);
      if (index % 3 === 0) {
        const bounds = randomBox(random, 10_000, 100);
        tree.insert(`again-${key}`, bounds);
        boxes.set(`again-${key}`, bounds);
      }
      if (index % 500 === 0) expect(tree.validate()).toEqual([]);
    });
    expect(tree.validate()).toEqual([]);
    expect(tree.size).toBe(boxes.size);
    queriesAgree(tree, boxes, 19);
  });

  it('shrinks back to an empty root when every entry is removed', () => {
    const entries = randomEntries(500, 8);
    const tree = new RTree<string>();
    tree.bulkLoad(entries);
    for (const { key } of entries) expect(tree.remove(key)).toBe(true);
    expect(tree.size).toBe(0);
    expect(tree.bounds).toBeUndefined();
    expect(tree.validate()).toEqual([]);
    tree.insert('again', { minX: 1, minY: 1, maxX: 2, maxY: 2 });
    expect(tree.searchPoint({ x: 1.5, y: 1.5 })).toEqual(['again']);
  });

  it('reports removing an absent key as a no-op', () => {
    const tree = new RTree<string>();
    tree.insert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(tree.remove('missing')).toBe(false);
    expect(tree.size).toBe(1);
  });

  it('refuses to insert a key twice, so a key maps to exactly one box', () => {
    const tree = new RTree<string>();
    tree.insert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(() => {
      tree.insert('a', { minX: 5, minY: 5, maxX: 6, maxY: 6 });
    }).toThrow(RangeError);
    expect(() => {
      tree.bulkLoad([{ key: 'a', bounds: { minX: 5, minY: 5, maxX: 6, maxY: 6 } }]);
    }).toThrow(RangeError);
    expect(() => {
      new RTree<string>().bulkLoad([
        { key: 'b', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } },
        { key: 'b', bounds: { minX: 5, minY: 5, maxX: 6, maxY: 6 } },
      ]);
    }).toThrow(RangeError);
  });

  it('refuses boxes with NaN or inverted edges, which no query could find', () => {
    const tree = new RTree<string>();
    expect(() => {
      tree.insert('nan', { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 });
    }).toThrow(RangeError);
    expect(() => {
      tree.update('inverted', { minX: 2, minY: 0, maxX: 1, maxY: 1 });
    }).toThrow(RangeError);
    expect(tree.size).toBe(0);
  });

  it('leaves the tree untouched when an update keeps the same box', () => {
    const tree = new RTree<string>();
    tree.bulkLoad(randomEntries(100, 9));
    const bounds = tree.boundsOf('b7');
    expect(bounds).toBeDefined();
    if (!bounds) return;
    expect(tree.update('b7', { ...bounds })).toBe(false);
    expect(tree.update('b7', { ...bounds, maxX: bounds.maxX + 1 })).toBe(true);
    expect(tree.boundsOf('b7')).toEqual({ ...bounds, maxX: bounds.maxX + 1 });
  });

  it('inserts through update when the key is new', () => {
    const tree = new RTree<string>();
    expect(tree.update('new', { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(true);
    expect(tree.searchPoint({ x: 0.5, y: 0.5 })).toEqual(['new']);
  });

  it('adds a bulk load to a non-empty tree one entry at a time', () => {
    const tree = new RTree<string>();
    tree.insert('first', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    const entries = randomEntries(300, 10);
    tree.bulkLoad(entries);
    expect(tree.size).toBe(301);
    expect(tree.validate()).toEqual([]);
    const boxes = new Map(entries.map(({ key, bounds }) => [key, bounds]));
    boxes.set('first', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    queriesAgree(tree, boxes, 11);
  });

  it('answers point queries, edges included', () => {
    const entries = randomEntries(1_000, 12);
    const tree = new RTree<string>();
    tree.bulkLoad(entries);
    const random = seededRandom(13);
    for (let index = 0; index < 100; index += 1) {
      const point = { x: random() * 10_000, y: random() * 10_000 };
      const expected = entries
        .filter(({ bounds }) => containsPoint(bounds, point))
        .map(({ key }) => key);
      expect(sorted(tree.searchPoint(point))).toEqual(sorted(expected));
    }
    const corner = entries[0]?.bounds;
    if (corner) expect(tree.searchPoint({ x: corner.maxX, y: corner.maxY })).toContain('b0');
  });

  it('finds a box whose edge the query only touches, on every side', () => {
    const tree = new RTree<string>();
    tree.bulkLoad(randomEntries(500, 20, 1_000, 10));
    tree.insert('target', { minX: 2000, minY: 2000, maxX: 2010, maxY: 2010 });
    const touching = [
      { minX: 1990, minY: 2003, maxX: 2000, maxY: 2004 }, // its left edge
      { minX: 2010, minY: 2003, maxX: 2020, maxY: 2004 }, // its right edge
      { minX: 2003, minY: 1990, maxX: 2004, maxY: 2000 }, // its top edge
      { minX: 2003, minY: 2010, maxX: 2004, maxY: 2020 }, // its bottom edge
      { minX: 2010, minY: 2010, maxX: 2010, maxY: 2010 }, // its corner, a point
    ];
    for (const query of touching) expect(tree.searchRect(query)).toEqual(['target']);
    expect(tree.searchRect({ minX: 2010.001, minY: 2003, maxX: 2020, maxY: 2004 })).toEqual([]);
  });

  it('takes a whole subtree without per-box tests when the query shares its outer edges', () => {
    // A 4-capacity tree over a 10 × 10 grid of unit boxes: the query is exactly the grid's
    // bounds, so it contains every subtree (edges shared) and the containment shortcut collects
    // them; a query inset by a hair must still find the boxes it touches one by one.
    const entries = [];
    for (let index = 0; index < 100; index += 1) {
      const x = (index % 10) * 2;
      const y = Math.floor(index / 10) * 2;
      entries.push({
        key: `g${String(index)}`,
        bounds: { minX: x, minY: y, maxX: x + 1, maxY: y + 1 },
      });
    }
    const tree = new RTree<string>({ maxEntries: 4 });
    tree.bulkLoad(entries);
    const exact = tree.bounds;
    expect(exact).toEqual({ minX: 0, minY: 0, maxX: 19, maxY: 19 });
    if (!exact) return;
    expect(sorted(tree.searchRect(exact))).toEqual(sorted(entries.map(({ key }) => key)));
    // The left column's boxes span x 0..1; a query from x 1 touches their right edges only.
    const fromEdge = { minX: 1, minY: 0, maxX: 19, maxY: 19 };
    expect(tree.searchRect(fromEdge)).toHaveLength(100);
    const pastEdge = { minX: 1.5, minY: 0, maxX: 19, maxY: 19 };
    expect(tree.searchRect(pastEdge)).toHaveLength(90);
  });

  it('reports the union of every box as its bounds', () => {
    const tree = new RTree<string>();
    tree.insert('a', { minX: 0, minY: 5, maxX: 1, maxY: 6 });
    tree.insert('b', { minX: -3, minY: 0, maxX: 2, maxY: 1 });
    expect(tree.bounds).toEqual({ minX: -3, minY: 0, maxX: 2, maxY: 6 });
  });

  it('returns every entry of a subtree the query contains, without testing each box', () => {
    const entries = randomEntries(2_000, 14);
    const tree = new RTree<string>();
    tree.bulkLoad(entries);
    const everything = { minX: -1, minY: -1, maxX: 20_000, maxY: 20_000 };
    expect(tree.searchRect(everything)).toHaveLength(2_000);
  });

  it('empties with clear', () => {
    const tree = new RTree<string>();
    tree.bulkLoad(randomEntries(100, 15));
    tree.clear();
    expect(tree.size).toBe(0);
    expect(tree.boundsOf('b1')).toBeUndefined();
    expect(tree.validate()).toEqual([]);
  });

  it('does not keep or mutate the boxes it is given', () => {
    const tree = new RTree<string>();
    const bounds = Object.freeze({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    tree.insert('a', bounds);
    tree.insert('b', { minX: 10, minY: 10, maxX: 11, maxY: 11 });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('rejects a node capacity below 4, which the split cannot honour', () => {
    expect(() => new RTree<string>({ maxEntries: 3 })).toThrow(RangeError);
    expect(() => new RTree<string>({ maxEntries: 4.5 })).toThrow(RangeError);
    const small = new RTree<string>({ maxEntries: 4 });
    for (const { key, bounds } of randomEntries(200, 16)) small.insert(key, bounds);
    expect(small.validate()).toEqual([]);
  });
});
