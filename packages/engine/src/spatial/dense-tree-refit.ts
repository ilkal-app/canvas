import { boundsArea } from './bounds.js';
import {
  checkBounds,
  createNode,
  innerNodeAround,
  leafAround,
  refitNode,
  type RTreeItem,
  type RTreeNode,
} from './r-tree-node.js';
import type { RTreeEntry } from './r-tree.js';
import { strPack } from './str-pack.js';

/**
 * Packs owned items without copying or changing their key/box associations.
 *
 * @param items - The tree's own item objects.
 * @param capacity - Maximum entries per node.
 * @returns A balanced STR tree, including the empty case.
 */
export function packTreeItems<Key>(items: RTreeItem<Key>[], capacity: number): RTreeNode<Key> {
  let level = strPack(items, capacity).map((group) => leafAround(group));
  while (level.length > 1) level = strPack(level, capacity).map((group) => innerNodeAround(group));
  return level[0] ?? createNode(1);
}

/**
 * Sums non-root node areas and edge lengths to measure spatial-grouping quality.
 * Edge lengths preserve the growth signal for valid zero-area boxes.
 *
 * @param root - The root whose own area is excluded.
 * @param shouldRefit - Whether to tighten every node after updating owned items.
 * @returns Summed box cost; only a performance heuristic, never a query predicate.
 */
function refitCost<Key>(root: RTreeNode<Key>, shouldRefit: boolean): number {
  let cost = 0;
  for (const child of root.children) {
    cost += refitCost(child, shouldRefit) + boundsArea(child);
    cost += child.maxX - child.minX + (child.maxY - child.minY);
  }
  if (shouldRefit) refitNode(root);
  return cost;
}

/** Dense exact updates keep leaf membership until its measured box growth warrants repacking. */
export class DenseTreeRefit<Key> {
  private baseline: number | undefined;

  /** Invalidates the quality reference after an ordinary structural tree edit. */
  reset(): void {
    this.baseline = undefined;
  }

  /**
   * Updates existing dense entries and refits every ancestor once, preserving exact queries.
   * Sparse batches and any newly inserted key use the ordinary update path instead.
   *
   * @param root - Current tree, owned by its caller.
   * @param items - Its owned items keyed by identity.
   * @param entries - New bounds; neither retained nor mutated.
   * @param capacity - Maximum entries per node when repacking.
   * @returns The refitted or repacked root, or undefined to use ordinary updates.
   * @throws {RangeError} Before changing a dense batch containing invalid bounds.
   */
  update(
    root: RTreeNode<Key>,
    items: ReadonlyMap<Key, RTreeItem<Key>>,
    entries: readonly RTreeEntry<Key>[],
    capacity: number,
  ): RTreeNode<Key> | undefined {
    if (entries.length < 64 || entries.length * 2 < items.size) return undefined;
    for (const { key, bounds } of entries) {
      if (!items.has(key)) return undefined;
      checkBounds(bounds);
    }
    this.baseline ??= refitCost(root, false);
    for (const { key, bounds } of entries) {
      const item = items.get(key);
      if (item === undefined) continue;
      item.minX = bounds.minX;
      item.minY = bounds.minY;
      item.maxX = bounds.maxX;
      item.maxY = bounds.maxY;
    }
    const cost = refitCost(root, true);
    if (cost <= this.baseline * 2) return root;
    const packed = packTreeItems([...items.values()], capacity);
    this.baseline = refitCost(packed, false);
    return packed;
  }
}
