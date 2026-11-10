import { describe, expect, it } from 'vitest';

import {
  collectNodeProblems,
  createNode,
  innerNodeAround,
  itemOf,
  leafAround,
  type RTreeNode,
} from './r-tree-node.js';

function leafOf(count: number, offset = 0): RTreeNode<string> {
  return leafAround(
    Array.from({ length: count }, (unused, index) =>
      itemOf(`k${String(offset + index)}`, { minX: index, minY: 0, maxX: index + 1, maxY: 1 }),
    ),
  );
}

function problemsOf(root: RTreeNode<string>): string[] {
  const problems: string[] = [];
  collectNodeProblems(root, true, 2, 4, problems);
  return problems;
}

describe('collectNodeProblems', () => {
  it('finds nothing wrong with a sound tree', () => {
    expect(problemsOf(innerNodeAround([leafOf(2), leafOf(3, 10)]))).toEqual([]);
  });

  it('reports overfull and underfull nodes, but lets the root be small', () => {
    expect(problemsOf(leafOf(5))).toEqual(['node at height 1 with 5 entries is overfull']);
    expect(problemsOf(leafOf(1))).toEqual([]);
    expect(problemsOf(innerNodeAround([leafOf(1), leafOf(2, 10)]))).toEqual([
      'node at height 1 with 1 entries is underfull',
    ]);
  });

  it('reports a box that is not the union of its entries', () => {
    const leaf = leafOf(2);
    leaf.maxX += 1;
    expect(problemsOf(leaf)).toEqual([
      'node at height 1 with 2 entries has a box that is not the union of its entries',
    ]);
  });

  it('reports a leaf holding children and a child at the wrong height', () => {
    const leaf = leafOf(2);
    leaf.children.push(createNode(1));
    expect(problemsOf(leaf)).toContain('node at height 1 with 2 entries mixes items and children');
    const tall = innerNodeAround([leafOf(2), leafOf(2, 10)]);
    tall.height = 3;
    expect(problemsOf(tall)).toContain(
      'node at height 3 with 2 entries has a child at the wrong height',
    );
  });
});
