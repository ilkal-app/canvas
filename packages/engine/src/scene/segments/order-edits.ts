// Edits in the middle of the paint order: leaf objects created, deleted, reparented or
// restacked anywhere (a sticky placed in a section, a stroke committed into one) change the order
// at their own ranks only, so the order's tables are spliced rather than walked again, and every
// table indexed by rank is moved through one shift. Pure apart from the reads and the rank
// indexes it keeps current.
import type { ObjectId } from '@canvas/schema';

import type { ScenePass } from '../scene-pass.js';

import { occludersByRank, type RanksByObject } from './closing-ranks.js';
import type { OrderTables } from './paint-order-tables.js';
import type { StackedObject } from './sibling-lists.js';
import type { ZOrderMirror } from './z-order-mirror.js';

/** A paint order's ranks before and after an edit in its middle. */
export interface RankShift {
  /** How many ranks the order has after the edit. */
  readonly length: number;
  /**
   * Per rank of the order before the edit, its rank after, or -1 where the edit removed it: a
   * table, so moving another table through the shift is one lookup per entry. A view of a buffer
   * the next edit reuses: read it in the frame of the edit.
   */
  readonly newRanks: Int32Array;
  /** The lowest rank the edit moved or removed: every rank below it keeps its number. */
  readonly firstMoved: number;
  /** The objects the edit inserted, each with its new rank, bottom first. */
  readonly inserted: readonly (readonly [id: ObjectId, rank: number])[];
}

/** Where an object paints next to: right after an object's own or closing rank. */
interface Anchor {
  readonly id: ObjectId;
  readonly isClosing: boolean;
}

/**
 * How many of an ascending list are below a value.
 *
 * @param sorted - The list, ascending.
 * @param value - The value.
 * @returns The count.
 */
function countBelow(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The paint order's tables after the mirror's edited objects (`ZOrderMirror.editedIds`): each
 * edited object the order held loses its rank, and each the mirror holds now takes the rank right
 * after what paints just below it — its lower sibling's subtree's last rank (that sibling's
 * closing rank when it has one), else its parent's own rank, else the order's start. The order is
 * built in one pass, the occluder flags of the kept ranks carried over, and the rank indexes moved
 * in place (`RankIndex.remap`). Undefined, touching nothing, when the edit cannot be placed this
 * way (an edited object with a closing rank, an anchor the order does not hold, a cycle): the
 * caller walks the order again.
 *
 * @param tables - The order's tables before the edit, walked from its roots.
 * @param mirror - The mirror, having observed the frame's change sets.
 * @param passes - The scene's passes, for the inserted objects' occluder flags.
 * @param ranks - The order's rank indexes before the edit; kept current when it applies.
 * @returns The tables and the shift, or undefined.
 */
export function editedOrder(
  tables: OrderTables,
  mirror: ZOrderMirror,
  passes: readonly ScenePass[],
  ranks: RanksByObject,
): { readonly tables: OrderTables; readonly shift: RankShift } | undefined {
  const { rankById, closingRankById } = ranks;
  const removedIds: ObjectId[] = [];
  const removedRanks: number[] = [];
  const insertedIds: ObjectId[] = [];
  for (const id of mirror.editedIds) {
    const rank = rankById.get(id);
    if (rank !== undefined) {
      if (closingRankById.has(id)) return undefined;
      removedIds.push(id);
      removedRanks.push(rank);
    }
    if (mirror.get(id) !== undefined) insertedIds.push(id);
  }
  removedRanks.sort((left, right) => left - right);
  const inserted = new Set(insertedIds);
  const anchors = anchorsOf(insertedIds, mirror, inserted, closingRankById);
  const placed = anchors && placementsOf(anchors, inserted, ranks, removedRanks);
  if (placed === undefined) return undefined;
  const { placedIds, keptBefore } = placed;
  const length = tables.paintOrder.length - removedRanks.length + placedIds.length;
  const newRanks = shiftTable(tables.paintOrder.length, removedRanks, keptBefore);
  // Below the first removal and the first insertion's place, the kept ranks keep their numbers.
  const firstMoved = Math.min(
    removedRanks[0] ?? newRanks.length,
    (keptBefore[0] ?? newRanks.length) + 1,
  );
  const insertedRanks = placedIds.map(
    (id, index) => [id, (keptBefore[index] ?? 0) + 1 + index] as const,
  );
  const { paintOrder, isClosingRank, carried } = splicedInPlace(
    tables,
    removedRanks,
    insertedRanks,
  );
  const occluders = (ids: readonly ObjectId[], closing: Uint8Array) =>
    occludersByRank(ids, closing, mirror, passes);
  let isOccluderByRank: Uint8Array<ArrayBuffer> = carried;
  if (mirror.isOccludersDirty) isOccluderByRank = occluders(paintOrder, isClosingRank);
  else {
    const flags = occluders(placedIds, new Uint8Array(placedIds.length));
    insertedRanks.forEach(([, rank], index) => (carried[rank] = flags[index] ?? 0));
  }
  for (const id of removedIds) rankById.delete(id);
  rankById.remap(newRanks, firstMoved);
  closingRankById.remap(newRanks, firstMoved);
  for (const [id, rank] of insertedRanks) rankById.set(id, rank);
  return {
    tables: { paintOrder, isClosingRank, isOccluderByRank, isFromRoots: true },
    shift: { length, newRanks, firstMoved, inserted: insertedRanks },
  };
}

/** The buffer `shiftTable` writes each edit's table into. */
let shiftBuffer = new Int32Array(0);

/**
 * Each old rank's new rank (`RankShift.newRanks`), in one pass: a removed rank -1; a kept one its
 * index among the kept ranks plus the inserted objects placed before it.
 *
 * @param length - How many ranks the order had.
 * @param removedRanks - The ranks removed, ascending.
 * @param keptBefore - Per inserted object, bottom first, the kept rank it follows (ascending).
 * @returns The table.
 */
function shiftTable(
  length: number,
  removedRanks: readonly number[],
  keptBefore: readonly number[],
): Int32Array {
  // One buffer for every edit (a stroke a second on a 50k board would otherwise allocate 200 KB
  // a stroke for the collector): the table lives for the frame of its edit.
  if (shiftBuffer.length < length) shiftBuffer = new Int32Array(Math.max(16, 2 * length));
  const newRanks = shiftBuffer.subarray(0, length);
  let removed = 0;
  let inserted = 0;
  for (let rank = 0; rank < length; rank += 1) {
    if (removedRanks[removed] === rank) {
      newRanks[rank] = -1;
      removed += 1;
      continue;
    }
    const kept = rank - removed;
    while ((keptBefore[inserted] ?? Number.POSITIVE_INFINITY) < kept) inserted += 1;
    newRanks[rank] = kept + inserted;
  }
  return newRanks;
}

/**
 * Whether an ascending list holds a value.
 *
 * @param sorted - The list, ascending.
 * @param value - The value.
 * @returns True when it does.
 */
function isIn(sorted: readonly number[], value: number): boolean {
  return sorted[countBelow(sorted, value)] === value;
}

/**
 * The inserted objects in their new order, each with the kept rank it follows (its index among
 * the ranks the edit keeps, -1 before them all): runs of inserted objects, each after one kept
 * rank, within a run each after the one before.
 *
 * @param anchors - What each inserted object paints right after (`anchorsOf`).
 * @param inserted - The inserted objects.
 * @param ranks - The order's rank indexes before the edit.
 * @param removedRanks - The ranks the edit removes, ascending.
 * @returns The objects bottom first and, per object, the kept rank it follows (ascending); or
 *   undefined when they do not form such runs (an anchor removed or missing, a cycle).
 */
function placementsOf(
  anchors: ReadonlyMap<ObjectId, Anchor | null>,
  inserted: ReadonlySet<ObjectId>,
  ranks: RanksByObject,
  removedRanks: readonly number[],
): { readonly placedIds: ObjectId[]; readonly keptBefore: number[] } | undefined {
  const next = new Map<ObjectId, ObjectId>();
  const runs: { readonly kept: number; readonly first: ObjectId }[] = [];
  for (const [id, anchor] of anchors) {
    if (anchor !== null && inserted.has(anchor.id)) {
      if (anchor.isClosing || next.has(anchor.id)) return undefined;
      next.set(anchor.id, id);
      continue;
    }
    let kept = -1;
    if (anchor !== null) {
      const rank = (anchor.isClosing ? ranks.closingRankById : ranks.rankById).get(anchor.id);
      if (rank === undefined || isIn(removedRanks, rank)) return undefined;
      kept = rank - countBelow(removedRanks, rank);
    }
    runs.push({ kept, first: id });
  }
  runs.sort((left, right) => left.kept - right.kept);
  const placedIds: ObjectId[] = [];
  const keptBefore: number[] = [];
  for (const [index, { kept, first }] of runs.entries()) {
    if (index > 0 && runs[index - 1]?.kept === kept) return undefined;
    for (let id: ObjectId | undefined = first; id !== undefined; id = next.get(id)) {
      if (placedIds.length === inserted.size) return undefined;
      placedIds.push(id);
      keptBefore.push(kept);
    }
  }
  // Inserted objects reached from no run hang off each other: a cycle.
  return placedIds.length === inserted.size ? { placedIds, keptBefore } : undefined;
}

/**
 * A byte table with ranks removed (each byte after them moved down) and zeros inserted at new
 * ranks, in its own buffer when it has room (the tables keep spare capacity, as `extended` does
 * for an edit at the end), else in one twice as large: a few moves of the bytes, no new table
 * per edit. Only the returned view is current.
 *
 * @param table - The table, a view from offset 0 of its buffer.
 * @param removedRanks - The ranks removed, ascending.
 * @param insertedRanks - The new ranks inserted, ascending.
 * @returns The table, as long as the order after the edit.
 */
function splicedBytes(
  table: Uint8Array,
  removedRanks: readonly number[],
  insertedRanks: readonly number[],
): Uint8Array<ArrayBuffer> {
  const length = table.length - removedRanks.length + insertedRanks.length;
  const most = Math.max(table.length, length);
  const room = table.byteOffset === 0 ? table.buffer.byteLength : 0;
  const isRoomy = room >= most && table.buffer instanceof ArrayBuffer;
  const buffer = isRoomy ? table.buffer : new ArrayBuffer(Math.max(16, 2 * most));
  const bytes = new Uint8Array(buffer, 0, most);
  if (!isRoomy) bytes.set(table);
  let size = table.length;
  for (let index = removedRanks.length - 1; index >= 0; index -= 1) {
    const rank = removedRanks[index] ?? 0;
    bytes.copyWithin(rank, rank + 1, size);
    size -= 1;
  }
  for (const rank of insertedRanks) {
    bytes.copyWithin(rank + 1, rank, size);
    bytes[rank] = 0;
    size += 1;
  }
  return new Uint8Array(buffer, 0, length);
}

/**
 * The order and its byte tables with ranks removed and objects inserted, in place: the order
 * spliced (removals from the top down, then insertions bottom up at their new ranks), its byte
 * tables moved within their spare capacity (`splicedBytes`). Kept ranks carry their closing and
 * occluder flags; inserted ones are neither (the caller flags occluders). The tables passed in
 * are current no more (the stage re-plans in the frame of every edit, so no plan keeps them).
 *
 * @param tables - The order's tables before the edit.
 * @param removedRanks - The ranks removed, ascending.
 * @param insertedRanks - The inserted objects with their new ranks, ascending.
 * @returns The order, its closing flags and the carried occluder flags.
 */
function splicedInPlace(
  tables: OrderTables,
  removedRanks: readonly number[],
  insertedRanks: readonly (readonly [ObjectId, number])[],
): {
  paintOrder: ObjectId[];
  isClosingRank: Uint8Array<ArrayBuffer>;
  carried: Uint8Array<ArrayBuffer>;
} {
  const paintOrder = tables.paintOrder as ObjectId[];
  for (let index = removedRanks.length - 1; index >= 0; index -= 1)
    paintOrder.splice(removedRanks[index] ?? 0, 1);
  for (const [id, rank] of insertedRanks) paintOrder.splice(rank, 0, id);
  const ranks = insertedRanks.map(([, rank]) => rank);
  return {
    paintOrder,
    isClosingRank: splicedBytes(tables.isClosingRank, removedRanks, ranks),
    carried: splicedBytes(tables.isOccluderByRank, removedRanks, ranks),
  };
}

/**
 * What each inserted object paints right after, from the sibling lists as they are now: the last
 * rank of its lower sibling's subtree, else its parent's own rank, else nothing (`null`: the
 * order's start).
 *
 * @param insertedIds - The inserted objects.
 * @param mirror - The mirror.
 * @param inserted - The same objects, as a set.
 * @param closingRankById - The order's closing ranks before the edit.
 * @returns Each object's anchor, or undefined when one is not where its z key puts it.
 */
function anchorsOf(
  insertedIds: readonly ObjectId[],
  mirror: ZOrderMirror,
  inserted: ReadonlySet<ObjectId>,
  closingRankById: ReadonlyMap<ObjectId, number>,
): Map<ObjectId, Anchor | null> | undefined {
  const { siblings } = mirror;
  // The last rank of an object's subtree; an inserted object has no closing rank.
  const subtreeEnd = (object: StackedObject): Anchor | undefined => {
    let current = object;
    // At most every object deep: the order was walked from its roots, so it holds no cycle.
    for (let depth = 0; depth <= mirror.objectCount; depth += 1) {
      if (!inserted.has(current.id) && closingRankById.has(current.id))
        return { id: current.id, isClosing: true };
      const last = siblings.childrenOf(current.id).at(-1);
      if (last === undefined) return { id: current.id, isClosing: false };
      current = last;
    }
    return undefined;
  };
  const anchors = new Map<ObjectId, Anchor | null>();
  for (const id of insertedIds) {
    const object = mirror.get(id);
    const index = object === undefined ? -1 : siblings.indexOf(object);
    if (object === undefined || index < 0) return undefined;
    const below = siblings.childrenOf(object.parentId)[index - 1];
    const anchor =
      below === undefined
        ? object.parentId === null
          ? null
          : { id: object.parentId, isClosing: false }
        : subtreeEnd(below);
    if (anchor === undefined) return undefined;
    anchors.set(id, anchor);
  }
  return anchors;
}
