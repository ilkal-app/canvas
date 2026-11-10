import type { ObjectId } from '@canvas/schema';

import type { ScenePass } from '../scene-pass.js';
import type { Scene } from '../scene.js';

import { occludersByRank, ranksByObject, type RanksByObject } from './closing-ranks.js';
import { editedOrder, type RankShift } from './order-edits.js';
import { paintRanksOfSiblings } from './paint-order.js';
import type { ZOrderMirror } from './z-order-mirror.js';

/** The paint order's tables, as `ZOrderSegments` keeps them. */
export interface OrderTables {
  /** Per paint rank, its object; an object with a closing rank appears at both its ranks. */
  readonly paintOrder: readonly ObjectId[];
  /** Per rank, 1 where it is a closing rank. */
  readonly isClosingRank: Uint8Array;
  /** Per rank, 1 for an occluder (`occludersByRank`). */
  readonly isOccluderByRank: Uint8Array;
  /** Whether the order's last walk reached every object from the roots (`PaintRanks`). */
  readonly isFromRoots: boolean;
}

/**
 * The tables before any walk: nothing is appended to them (`isFromRoots` false), so the first
 * objects build the order, and with it the slot-owner tables, from scratch.
 */
export const EMPTY_ORDER: OrderTables = {
  paintOrder: [],
  isClosingRank: new Uint8Array(0),
  isOccluderByRank: new Uint8Array(0),
  isFromRoots: false,
};

/**
 * What a frame did to the paint order: kept it, changed only its end (`appended`: objects deleted
 * from it and objects created above every other), changed leaf objects anywhere in it
 * (`edited`), or rebuilt it.
 */
export type OrderChange = 'kept' | 'appended' | 'edited' | 'rebuilt';

/**
 * A byte table cut to its first `kept` ranks and extended by `added`, as a view of exactly its
 * length: written into the table's own buffer when it has room past `kept` (the tables keep spare
 * capacity, so an edit at the end costs what it adds), else into a buffer twice as large.
 * The previous view's ranks from `kept` on may be overwritten: only the returned view is current.
 *
 * @param table - The table, a view from offset 0 of its buffer.
 * @param kept - How many of its ranks stay.
 * @param added - The added ranks' bytes.
 * @returns The table, `kept + added.length` long.
 */
function extended(table: Uint8Array, kept: number, added: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = kept + added.length;
  const room = table.byteOffset === 0 ? table.buffer.byteLength : 0;
  const isRoomy = room >= length && table.buffer instanceof ArrayBuffer;
  const buffer = isRoomy ? table.buffer : new ArrayBuffer(Math.max(16, 2 * length));
  const next = new Uint8Array(buffer, 0, length);
  if (!isRoomy) next.set(table.subarray(0, kept));
  next.set(added, kept);
  return next;
}

/**
 * The paint order's tables after a frame's change sets reached the mirror. A changed order is
 * walked again (`paintRanksOfSiblings`, O(n)), unless its order was walked from its roots and
 * its only changes are:
 * - at its end: objects deleted from the end (`ZOrderMirror.trimmedIds`) are dropped and objects
 *   created above every other (`appendedIds`) appended, at the cost of what changed (a stroke
 *   committed on a 50k board in place of its preview): the paint order is cut and
 *   extended in place, the byte tables within their spare capacity;
 * - leaf objects anywhere (`editedIds`: a sticky placed in a section): the order is
 *   spliced in one pass of typed arrays (`editedOrder`), and `shift` says where every old rank
 *   went, for the other tables indexed by rank.
 *
 * An occluder that changed state rebuilds that table alone. Pure apart from the mirror's reads
 * and the rank indexes it keeps current.
 *
 * @param tables - The tables the last frame left.
 * @param mirror - The mirror, having observed this frame's change sets.
 * @param passes - The scene's passes.
 * @param ranks - The order's own and closing rank indexes (`ranksByObject`), when built: an
 *   appended or edited order keeps them current in place (an edited one builds its own when
 *   absent); a rebuilt order leaves them stale.
 * @returns The tables, what changed, and for an edited order, where its ranks went.
 */
export function refreshOrder(
  tables: OrderTables,
  mirror: ZOrderMirror,
  passes: readonly ScenePass[],
  ranks?: RanksByObject,
): { readonly tables: OrderTables; readonly change: OrderChange; readonly shift?: RankShift } {
  const { appendedIds, trimmedIds, editedIds } = mirror;
  const order = tables.paintOrder;
  const kept = order.length - trimmedIds.length;
  const isEdited = appendedIds.length > 0 || trimmedIds.length > 0;
  // The trimmed objects must be the order's own end, as the mirror saw them.
  const isTrimOfEnd = kept >= 0 && trimmedIds.every((id, index) => order[kept + index] === id);
  const occluders = (paintOrder: readonly ObjectId[], isClosingRank: Uint8Array) =>
    occludersByRank(paintOrder, isClosingRank, mirror, passes);
  const isMidEdited = editedIds.size > 0 && !isEdited && tables.isFromRoots;
  const edit =
    isMidEdited && !mirror.isOrderDirty
      ? editedOrder(tables, mirror, passes, ranks ?? ranksByObject(order, tables.isClosingRank))
      : undefined;
  if (edit) return { ...edit, change: 'edited' };
  if (
    mirror.isOrderDirty ||
    editedIds.size > 0 ||
    (isEdited && (!tables.isFromRoots || !isTrimOfEnd))
  ) {
    const walked = paintRanksOfSiblings(mirror.siblings, (id) => {
      const object = mirror.get(id);
      return object !== undefined && mirror.hasClosingRank(object, passes);
    });
    const { ids: paintOrder, isClosingRank, isFromRoots } = walked;
    const isOccluderByRank = occluders(paintOrder, isClosingRank);
    return {
      tables: { paintOrder, isClosingRank, isOccluderByRank, isFromRoots },
      change: 'rebuilt',
    };
  }
  if (isEdited) {
    for (const id of trimmedIds) ranks?.rankById.delete(id);
    appendedIds.forEach((id, index) => ranks?.rankById.set(id, kept + index));
    // In place: the stage re-plans in the frame of every edit, so no plan keeps the old order.
    const paintOrder = order as ObjectId[];
    paintOrder.length = kept;
    paintOrder.push(...appendedIds);
    const added = new Uint8Array(appendedIds.length);
    const isClosingRank = extended(tables.isClosingRank, kept, added);
    const isOccluderByRank = mirror.isOccludersDirty
      ? occluders(paintOrder, isClosingRank)
      : extended(tables.isOccluderByRank, kept, occluders(appendedIds, added));
    return {
      tables: { paintOrder, isClosingRank, isOccluderByRank, isFromRoots: true },
      change: 'appended',
    };
  }
  if (!mirror.isOccludersDirty) return { tables, change: 'kept' };
  const isOccluderByRank = occluders(tables.paintOrder, tables.isClosingRank);
  return { tables: { ...tables, isOccluderByRank }, change: 'kept' };
}

/**
 * Whether an edit at the end of the paint order changes what the level of detail hides by rank:
 * a trimmed rank was hidden in some pass, or an appended object is hidden in one. Otherwise the
 * hidden tables stand as they are (a rank past a table's end reads as shown), at the cost of the
 * edit.
 *
 * @param scene - The scene, for its passes and level of detail.
 * @param hiddenByRank - Each pass's hidden table, in pass order.
 * @param kept - The ranks the edit kept.
 * @param appendedIds - The objects it appended.
 * @returns Whether the hidden tables must be rebuilt.
 */
export function isEndHidden(
  scene: Pick<Scene, 'passes' | 'levelOfDetail'>,
  hiddenByRank: readonly (Uint8Array | undefined)[],
  kept: number,
  appendedIds: readonly ObjectId[],
): boolean {
  return scene.passes.some(({ name }, index) => {
    const table = hiddenByRank[index];
    const hidden = scene.levelOfDetail.hiddenIn(name);
    return table?.subarray(kept).includes(1) === true || appendedIds.some((id) => hidden.has(id));
  });
}
