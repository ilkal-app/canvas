import type { WorldBounds } from '../camera/camera.js';

import { boundsArea, enlargedArea } from './bounds.js';

/** A box the tree owns and may grow in place. */
export interface MutableBounds {
  /** The left edge, world units. */
  minX: number;
  /** The top edge, world units. */
  minY: number;
  /** The right edge, world units. */
  maxX: number;
  /** The bottom edge, world units. */
  maxY: number;
}

/** One indexed entry: a key and the tree's own copy of its box. */
export interface RTreeItem<Key> extends MutableBounds {
  /** The key the entry is found by. */
  readonly key: Key;
}

/**
 * A node of the tree. A leaf (`height` 1) holds items; an inner node holds child nodes one level
 * lower. Its box is the union of its children's, kept tight on every change.
 */
export interface RTreeNode<Key> extends MutableBounds {
  /** 1 for a leaf, one more than its children's otherwise. */
  height: number;
  /** A leaf's items; empty for an inner node. */
  items: RTreeItem<Key>[];
  /** An inner node's children; empty for a leaf. */
  children: RTreeNode<Key>[];
}

/**
 * A node with no entries and an empty box (inverted, so any union replaces it).
 *
 * @param height - 1 for a leaf.
 * @returns The node.
 */
export function createNode<Key>(height: number): RTreeNode<Key> {
  return {
    height,
    items: [],
    children: [],
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/**
 * A node's entries: its items when a leaf, its children otherwise.
 *
 * @param node - The node.
 * @returns The live array of entries.
 */
export function entriesOf<Key>(node: RTreeNode<Key>): WorldBounds[] {
  return node.height === 1 ? node.items : node.children;
}

/**
 * Grows a box in place to contain another.
 *
 * @param target - The box to grow.
 * @param bounds - The box to contain.
 */
export function extendInPlace(target: MutableBounds, bounds: WorldBounds): void {
  target.minX = Math.min(target.minX, bounds.minX);
  target.minY = Math.min(target.minY, bounds.minY);
  target.maxX = Math.max(target.maxX, bounds.maxX);
  target.maxY = Math.max(target.maxY, bounds.maxY);
}

/**
 * Recomputes a node's box from its entries; empty when it has none.
 *
 * @param node - The node, updated in place.
 */
export function refitNode<Key>(node: RTreeNode<Key>): void {
  node.minX = Number.POSITIVE_INFINITY;
  node.minY = Number.POSITIVE_INFINITY;
  node.maxX = Number.NEGATIVE_INFINITY;
  node.maxY = Number.NEGATIVE_INFINITY;
  for (const entry of entriesOf(node)) extendInPlace(node, entry);
}

/**
 * A leaf holding items, with its box fitted.
 *
 * @param items - The items; the array is kept, not copied.
 * @returns The leaf.
 */
export function leafAround<Key>(items: RTreeItem<Key>[]): RTreeNode<Key> {
  const node = createNode<Key>(1);
  node.items = items;
  refitNode(node);
  return node;
}

/**
 * An inner node holding children one level lower, with its box fitted.
 *
 * @param children - The children, all of one height; the array is kept, not copied.
 * @returns The node, one level above its children.
 */
export function innerNodeAround<Key>(children: RTreeNode<Key>[]): RTreeNode<Key> {
  const node = createNode<Key>((children[0]?.height ?? 0) + 1);
  node.children = children;
  refitNode(node);
  return node;
}

/**
 * Checks a subtree's invariants: tight boxes, children one level lower, node sizes within
 * `[minEntries, maxEntries]` below the root, and leaves all at height 1.
 *
 * @param node - The subtree's root.
 * @param isRoot - Whether it is the tree's root, which may hold fewer than `minEntries`.
 * @param minEntries - The fewest entries a non-root node may hold.
 * @param maxEntries - The most entries any node may hold.
 * @param problems - Where to append one line per broken invariant.
 */
export function collectNodeProblems<Key>(
  node: RTreeNode<Key>,
  isRoot: boolean,
  minEntries: number,
  maxEntries: number,
  problems: string[],
): void {
  const entries = entriesOf(node);
  const at = `node at height ${String(node.height)} with ${String(entries.length)} entries`;
  if (entries.length > maxEntries) problems.push(`${at} is overfull`);
  if (!isRoot && entries.length < minEntries) problems.push(`${at} is underfull`);
  if (node.height === 1 ? node.children.length > 0 : node.items.length > 0) {
    problems.push(`${at} mixes items and children`);
  }
  const fitted = createNode<Key>(node.height);
  for (const entry of entries) extendInPlace(fitted, entry);
  if (
    fitted.minX !== node.minX ||
    fitted.minY !== node.minY ||
    fitted.maxX !== node.maxX ||
    fitted.maxY !== node.maxY
  ) {
    problems.push(`${at} has a box that is not the union of its entries`);
  }
  for (const child of node.children) {
    if (child.height !== node.height - 1) problems.push(`${at} has a child at the wrong height`);
    collectNodeProblems(child, false, minEntries, maxEntries, problems);
  }
}

/**
 * The child that grows least to take a box, then the smallest.
 *
 * @param children - An inner node's children, at least one.
 * @param bounds - The box to place.
 * @returns The chosen child.
 */
export function chooseSubtree<Key>(
  children: readonly RTreeNode<Key>[],
  bounds: WorldBounds,
): RTreeNode<Key> {
  let best = children[0] ?? createNode<Key>(1);
  let bestGrowth = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const child of children) {
    const area = boundsArea(child);
    const growth = enlargedArea(child, bounds) - area;
    if (growth < bestGrowth || (growth === bestGrowth && area < bestArea)) {
      best = child;
      bestGrowth = growth;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Appends the key of every item under a node.
 *
 * @param node - The subtree.
 * @param keys - Where to append.
 */
export function collectKeys<Key>(node: RTreeNode<Key>, keys: Key[]): void {
  for (const item of node.items) keys.push(item.key);
  for (const child of node.children) collectKeys(child, keys);
}

/**
 * Appends every item under a node.
 *
 * @param node - The subtree.
 * @param items - Where to append.
 */
export function collectItems<Key>(node: RTreeNode<Key>, items: RTreeItem<Key>[]): void {
  items.push(...node.items);
  for (const child of node.children) collectItems(child, items);
}

/**
 * The tree's own copy of an entry.
 *
 * @param key - The key.
 * @param bounds - Its box; copied.
 * @returns The item.
 */
export function itemOf<Key>(key: Key, bounds: WorldBounds): RTreeItem<Key> {
  return { key, minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
}

/**
 * Refuses a box no query could find reliably.
 *
 * @param bounds - The box.
 * @throws {RangeError} When an edge is NaN or a minimum exceeds its maximum.
 */
export function checkBounds(bounds: WorldBounds): void {
  if (!(bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY)) {
    throw new RangeError(
      `An R-tree box needs min ≤ max on both axes; got ${JSON.stringify(bounds)}.`,
    );
  }
}

/**
 * Checks balanced node geometry and the exact item/key association.
 *
 * @param root - The tree root.
 * @param items - The tree's key index.
 * @param minimum - Minimum non-root occupancy.
 * @param maximum - Maximum node occupancy.
 * @returns One description per broken invariant.
 */
export function validateTree<Key>(
  root: RTreeNode<Key>,
  items: ReadonlyMap<Key, RTreeItem<Key>>,
  minimum: number,
  maximum: number,
): string[] {
  const problems: string[] = [];
  collectNodeProblems(root, true, minimum, maximum, problems);
  const reachable: RTreeItem<Key>[] = [];
  collectItems(root, reachable);
  if (reachable.length !== items.size)
    problems.push(
      `${String(reachable.length)} items are reachable, ${String(items.size)} are keyed`,
    );
  if (reachable.some((item) => items.get(item.key) !== item))
    problems.push('a reachable item is not the one its key maps to');
  return problems;
}
