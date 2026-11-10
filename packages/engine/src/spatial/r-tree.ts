import type { ObjectId, Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { containsBounds, intersectsBounds, pointBounds } from './bounds.js';
import { DenseTreeRefit, packTreeItems } from './dense-tree-refit.js';
import { quadraticSplit } from './quadratic-split.js';
import {
  checkBounds,
  chooseSubtree,
  collectKeys,
  validateTree,
  createNode,
  entriesOf,
  extendInPlace,
  innerNodeAround,
  leafAround,
  refitNode,
  itemOf,
  type RTreeItem,
  type RTreeNode,
} from './r-tree-node.js';

/** Options for an {@link RTree}. */
export interface RTreeOptions {
  /** The most entries a node holds before it splits, at least 4. Default 16. */
  readonly maxEntries?: number;
}

/** A key and its box, as {@link RTree.bulkLoad} takes them. */
export interface RTreeEntry<Key> {
  /** The key; unique within the tree. */
  readonly key: Key;
  /** Its axis-aligned box, world units. */
  readonly bounds: WorldBounds;
}

const DEFAULT_MAX_ENTRIES = 16;

/** The smallest node capacity the quadratic split can keep at least 40% full. */
const SMALLEST_MAX_ENTRIES = 4;

/**
 * An R-tree over axis-aligned world boxes, one box per key (object bounds, for culling, hit
 * testing and marquee selection, so only visible objects cost anything). A first load is packed
 * with Sort-Tile-Recursive (`strPack`); later inserts descend by least enlargement and split
 * overfull nodes with Guttman's quadratic split (`quadraticSplit`); removal dissolves underfull
 * nodes and reinserts their entries. Queries return every key whose box meets the query box, edges
 * included, in no particular order. Pure data structure: no DOM, no clock; it copies the boxes it
 * is given and never mutates them. Not thread-safe; owned by one thread.
 */
export class RTree<Key = ObjectId> {
  private root: RTreeNode<Key> = createNode(1);
  private readonly itemsByKey = new Map<Key, RTreeItem<Key>>();
  private readonly maxEntries: number;
  private readonly minEntries: number;
  private readonly refitter = new DenseTreeRefit<Key>();

  /**
   * Creates an empty tree.
   *
   * @param options - Node capacity.
   * @throws {RangeError} When `maxEntries` is not an integer of at least 4.
   */
  constructor(options: RTreeOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries < SMALLEST_MAX_ENTRIES) {
      throw new RangeError(
        `maxEntries must be an integer of at least ${String(SMALLEST_MAX_ENTRIES)}; received ${String(maxEntries)}.`,
      );
    }
    this.maxEntries = maxEntries;
    this.minEntries = Math.max(2, Math.floor(maxEntries * 0.4));
  }

  /**
   * The number of keys in the tree.
   *
   * @returns The count.
   */
  get size(): number {
    return this.itemsByKey.size;
  }

  /**
   * The levels from the root to the leaves: 1 for an empty tree or a leaf root.
   *
   * @returns The height.
   */
  get height(): number {
    return this.root.height;
  }

  /**
   * The union of every box in the tree.
   *
   * @returns A copy of it, or `undefined` when the tree is empty.
   */
  get bounds(): WorldBounds | undefined {
    if (this.itemsByKey.size === 0) return undefined;
    const { minX, minY, maxX, maxY } = this.root;
    return { minX, minY, maxX, maxY };
  }

  /**
   * One key's box.
   *
   * @param key - The key.
   * @returns A copy of its box, or `undefined` when the key is not in the tree.
   */
  boundsOf(key: Key): WorldBounds | undefined {
    const item = this.itemsByKey.get(key);
    return item && { minX: item.minX, minY: item.minY, maxX: item.maxX, maxY: item.maxY };
  }

  /**
   * Adds many entries at once, packed with the tree's own by Sort-Tile-Recursive (far faster
   * than one by one, less overlap) unless they are fewer than the tree holds, then inserted one
   * by one: batches load as one. Checks every entry before changing anything.
   *
   * @param entries - The entries; not kept or mutated.
   * @throws {RangeError} When a key is already in the tree or appears twice, or a box has a NaN
   *   or inverted edge.
   */
  bulkLoad(entries: readonly RTreeEntry<Key>[]): void {
    const keys = new Set<Key>();
    for (const { key, bounds } of entries) {
      if (keys.has(key) || this.itemsByKey.has(key)) throw duplicateKeyError(key);
      keys.add(key);
      checkBounds(bounds);
    }
    if (entries.length < this.itemsByKey.size) {
      for (const { key, bounds } of entries) this.insert(key, bounds);
      return;
    }
    const items = entries.map(({ key, bounds }) => itemOf(key, bounds));
    if (items.length === 0) return;
    for (const item of items) this.itemsByKey.set(item.key, item);
    this.root = packTreeItems([...this.itemsByKey.values()], this.maxEntries);
    this.refitter.reset();
  }

  /**
   * Adds one entry.
   *
   * @param key - The key; not yet in the tree.
   * @param bounds - Its box, world units; copied.
   * @throws {RangeError} When the key is already in the tree, or the box has a NaN or inverted
   *   edge.
   */
  insert(key: Key, bounds: WorldBounds): void {
    if (this.itemsByKey.has(key)) throw duplicateKeyError(key);
    checkBounds(bounds);
    const item = itemOf(key, bounds);
    this.itemsByKey.set(key, item);
    this.refitter.reset();
    this.insertItem(item);
  }

  /**
   * Moves a key to a new box, or inserts it when absent. A box equal to the current one changes
   * nothing, so re-indexing an object whose bounds did not move (a recolour) is a map lookup.
   *
   * @param key - The key.
   * @param bounds - Its new box, world units; copied.
   * @returns True when the tree changed.
   * @throws {RangeError} When the box has a NaN or inverted edge.
   */
  update(key: Key, bounds: WorldBounds): boolean {
    checkBounds(bounds);
    const current = this.itemsByKey.get(key);
    if (
      current?.minX === bounds.minX &&
      current.minY === bounds.minY &&
      current.maxX === bounds.maxX &&
      current.maxY === bounds.maxY
    ) {
      return false;
    }
    if (current) this.remove(key);
    this.insert(key, bounds);
    return true;
  }

  /**
   * Updates a batch of boxes using the ordinary exact update semantics.
   *
   * @param entries - Changed keys and their new bounds.
   */
  updateMany(entries: readonly RTreeEntry<Key>[]): void {
    const refitted = this.refitter.update(this.root, this.itemsByKey, entries, this.maxEntries);
    if (refitted) this.root = refitted;
    else for (const { key, bounds } of entries) this.update(key, bounds);
  }

  /**
   * Removes a key.
   *
   * @param key - The key.
   * @returns True when the key was in the tree.
   */
  remove(key: Key): boolean {
    const item = this.itemsByKey.get(key);
    if (!item) return false;
    const path: RTreeNode<Key>[] = [];
    // Every item is in some leaf under a chain of boxes that contain it, so this always succeeds.
    this.findLeafPath(this.root, item, path);
    const leaf = path.at(-1);
    leaf?.items.splice(leaf.items.indexOf(item), 1);
    this.itemsByKey.delete(key);
    this.refitter.reset();
    this.condense(path);
    return true;
  }

  /**
   * Every key whose box meets a rectangle, edges included.
   *
   * @param rect - The query rectangle, world units.
   * @param keys - Where to add them; a new array by default, so a caller that searches every
   *   frame can reuse one (it is added to, not emptied).
   * @returns `keys`, with the found keys added in no particular order.
   */
  searchRect(rect: WorldBounds, keys: Key[] = []): Key[] {
    if (!intersectsBounds(this.root, rect)) return keys;
    const pending = [this.root];
    for (let node = pending.pop(); node; node = pending.pop()) {
      for (const item of node.items) if (intersectsBounds(item, rect)) keys.push(item.key);
      for (const child of node.children) {
        // A child the query swallows whole needs no more box tests.
        if (containsBounds(rect, child)) {
          collectKeys(child, keys);
        } else if (intersectsBounds(child, rect)) {
          pending.push(child);
        }
      }
    }
    return keys;
  }

  /**
   * Every key whose box contains a point, edges included.
   *
   * @param point - The point, world units.
   * @returns The keys, in no particular order; a new array.
   */
  searchPoint(point: Point): Key[] {
    return this.searchRect(pointBounds(point));
  }

  /** Removes every entry. */
  clear(): void {
    this.root = createNode(1);
    this.itemsByKey.clear();
    this.refitter.reset();
  }

  /**
   * Checks the tree's invariants, for tests and debugging: node sizes, tight boxes, balanced
   * height, and every key reachable exactly once.
   *
   * @returns One line per broken invariant; empty when the tree is sound.
   */
  validate(): string[] {
    return validateTree(this.root, this.itemsByKey, this.minEntries, this.maxEntries);
  }

  private insertItem(item: RTreeItem<Key>): void {
    const path = this.descend(item, 1);
    path.at(-1)?.items.push(item);
    this.splitOverfull(path);
  }

  /**
   * Puts a whole subtree back at its own level, under a node one level above it (Guttman's
   * condense step), rather than reinserting its items one by one. Orphaned subtrees are always
   * at least two levels below the root: they were children of a dissolved non-root node, and the
   * root shrinks by at most one level per removal (a non-root node keeps at least two children).
   *
   * @param subtree - The subtree.
   */
  private insertSubtree(subtree: RTreeNode<Key>): void {
    const path = this.descend(subtree, subtree.height + 1);
    path.at(-1)?.children.push(subtree);
    this.splitOverfull(path);
  }

  /**
   * Walks from the root down to a node of the given height by least enlargement, growing every
   * node on the way to contain the new entry's box.
   *
   * @param bounds - The box of the entry to place.
   * @param height - The height of the node that will hold it: 1 for an item.
   * @returns The nodes from the root down to that node.
   */
  private descend(bounds: WorldBounds, height: number): RTreeNode<Key>[] {
    const path: RTreeNode<Key>[] = [];
    let node = this.root;
    for (;;) {
      path.push(node);
      extendInPlace(node, bounds);
      if (node.height <= height) return path;
      node = chooseSubtree(node.children, bounds);
    }
  }

  /**
   * Splits overfull nodes from the bottom of an insertion path up, growing a new root when the
   * old one splits. A split node and its new sibling cover exactly the old node's box, so the
   * parent's box needs no refit.
   *
   * @param path - The nodes from the root down to the leaf that received an item.
   */
  private splitOverfull(path: readonly RTreeNode<Key>[]): void {
    for (let level = path.length - 1; level >= 0; level -= 1) {
      const node = path[level];
      if (!node || entriesOf(node).length <= this.maxEntries) return;
      const sibling = this.split(node);
      const parent = path[level - 1];
      if (parent) {
        parent.children.push(sibling);
      } else {
        this.root = innerNodeAround([node, sibling]);
      }
    }
  }

  private split(node: RTreeNode<Key>): RTreeNode<Key> {
    if (node.height === 1) {
      const [kept, moved] = quadraticSplit(node.items, this.minEntries);
      node.items = kept;
      refitNode(node);
      return leafAround(moved);
    }
    const [kept, moved] = quadraticSplit(node.children, this.minEntries);
    node.children = kept;
    refitNode(node);
    return innerNodeAround(moved);
  }

  private findLeafPath(
    node: RTreeNode<Key>,
    item: RTreeItem<Key>,
    path: RTreeNode<Key>[],
  ): boolean {
    path.push(node);
    if (node.height === 1 ? node.items.includes(item) : this.findInChildren(node, item, path)) {
      return true;
    }
    path.pop();
    return false;
  }

  private findInChildren(
    node: RTreeNode<Key>,
    item: RTreeItem<Key>,
    path: RTreeNode<Key>[],
  ): boolean {
    return node.children.some(
      (child) => containsBounds(child, item) && this.findLeafPath(child, item, path),
    );
  }

  /**
   * After a removal, walks the path up: an underfull node leaves its parent and its entries are
   * put back (items into leaves, child subtrees at their own level); the others are refitted.
   * Then a root with one child is replaced by that child.
   *
   * @param path - The nodes from the root down to the leaf the item left.
   */
  private condense(path: readonly RTreeNode<Key>[]): void {
    const orphanItems: RTreeItem<Key>[] = [];
    const orphanSubtrees: RTreeNode<Key>[] = [];
    for (let level = path.length - 1; level > 0; level -= 1) {
      const node = path[level];
      const parent = path[level - 1];
      if (!node || !parent) continue;
      if (entriesOf(node).length < this.minEntries) {
        parent.children.splice(parent.children.indexOf(node), 1);
        orphanItems.push(...node.items);
        orphanSubtrees.push(...node.children);
      } else {
        refitNode(node);
      }
    }
    refitNode(this.root);
    while (this.root.height > 1 && this.root.children.length <= 1) {
      this.root = this.root.children[0] ?? createNode(1);
    }
    // Taller subtrees first, so the tree keeps its height while they go back.
    orphanSubtrees.sort((a, b) => b.height - a.height);
    for (const subtree of orphanSubtrees) this.insertSubtree(subtree);
    for (const item of orphanItems) this.insertItem(item);
  }
}

function duplicateKeyError(key: unknown): RangeError {
  return new RangeError(`The R-tree already holds the key ${JSON.stringify(key)}.`);
}
