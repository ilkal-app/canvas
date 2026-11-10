import { compareKeys, type BoardObject, type ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import type { DocumentTransaction } from '../store/document-store.js';
import { DocumentWriteError } from '../store/document-write-error.js';

import { detachFromMissing } from './detach-references.js';
import { placeOnTop, reroot } from './orphan-placement.js';

// Concurrent edits can leave references no single command would: a client deletes a frame while
// another puts an object in it, connects to it or pins a comment on it; each command was valid
// where it ran, the merge keeps both, and every client converges to the same board with a
// dangling `parentId`, connector end or comment anchor (`validateBoard`: `missing-parent`,
// `missing-connector-target`, `missing-comment-anchor`; found by the sync fuzz harness,
//). An undo can leave the same. The repair applies the rules a delete follows,
// measured where the removed object was last seen:
// - an object whose parent is gone moves to the nearest surviving ancestor (or the root),
//   keeping its place on the board, on top of its new siblings in its old relative order;
// - a connector end on a removed object becomes a free point where it was, and a connector
//   whose two attached ends are both gone is deleted (a line from nowhere to nowhere);
// - a comment pinned to a removed object becomes a point pin where it was.
// A detach's undo can also turn a frame back into an instance while a peer adds a child offline.
// That child leaves the now-leaf parent by the same placement rule; connector ends
// and comment anchors still name a present object and remain attached.
// A path's network is not repaired here: the rules a merge can break inside a network are
// applied when the path is read (`codec/network-visibility.ts`), so nothing is lost by
// the order updates arrive in.
// It is a pure plan from reads, then writes, so every client that sees the same board and the
// same last-known objects writes the same values.

/** What the repair reads of the board as it is now (the store, or an open transaction). */
export interface RepairView {
  /**
   * An object as it is now.
   *
   * @param id - The object id.
   * @returns The object, or `undefined` when it is absent or cannot be read.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * Whether the document has an entry under an id, readable or not: an entry a merge left
   * unreadable for a while (an out-of-order update) is not a removed object.
   *
   * @param id - The object id.
   * @returns `true` when the entry exists.
   */
  isPresent(id: ObjectId): boolean;
}

/** The writes that repair a board's references, each sorted by id. */
export interface ReferenceRepairPlan {
  /** Objects to write whole (`setObject` writes only the fields that changed). */
  readonly updated: readonly BoardObject[];
  /** Connectors to delete: both of their attached ends are gone. */
  readonly deleted: readonly ObjectId[];
}

/** The plan when nothing refers to a missing object. */
const NOTHING_TO_REPAIR: ReferenceRepairPlan = Object.freeze({
  updated: Object.freeze([]),
  deleted: Object.freeze([]),
});

/**
 * Whether an existing readable object has become a leaf where a parent was expected.
 * Unreadable entries wait for their dependencies instead of being treated as removed.
 *
 * @param object - The current parent, if readable.
 * @returns Whether children must leave this object.
 */
function isLeaf(object: BoardObject | undefined): boolean {
  return (
    object !== undefined &&
    object.type !== 'group' &&
    object.type !== 'frame' &&
    object.type !== 'component'
  );
}

/**
 * The objects an object refers to: its parent, a connector's attached ends, a comment's anchor.
 *
 * @param object - The object.
 * @returns The referenced ids.
 */
function referencesOf(object: BoardObject): ObjectId[] {
  const ids = object.parentId === null ? [] : [object.parentId];
  if (object.type === 'connector') {
    for (const end of [object.from, object.to]) if (end.kind === 'object') ids.push(end.objectId);
  }
  if (object.type === 'comment' && object.anchor.kind === 'object') {
    ids.push(object.anchor.objectId);
  }
  return ids;
}

/**
 * The objects that may refer to a missing object after a change: those it created or changed,
 * and, by the reverse indexes, the dependents of those it removed or whose type became a leaf.
 *
 * @param now - The board now.
 * @param before - A board whose indexes still list the removed objects' dependents.
 * @param touched - The objects the change created, changed or removed.
 * @returns The candidates on the board now, sorted by id.
 */
function candidatesOf(now: RepairView, before: BoardReader, touched: Iterable<ObjectId>) {
  const candidates = new Set<ObjectId>();
  const { references } = before;
  for (const id of touched) {
    if (now.isPresent(id)) {
      candidates.add(id);
      // A detach's undo can replace a frame by an instance while an offline peer adds a child.
      if (isLeaf(now.get(id))) for (const child of references.childrenOf(id)) candidates.add(child);
      continue;
    }
    for (const dependent of [
      ...references.childrenOf(id),
      ...references.connectorsAttachedTo(id),
      ...references.commentsAnchoredTo(id),
    ]) {
      if (now.isPresent(dependent)) candidates.add(dependent);
    }
  }
  return [...candidates].sort();
}

/**
 * Whether a connector has both ends attached and both targets missing.
 *
 * @param object - The object.
 * @param isPresent - Whether an object is on the board.
 * @returns `true` for a connector left with no target at all.
 */
function isStranded(object: BoardObject, isPresent: (id: ObjectId) => boolean): boolean {
  return (
    object.type === 'connector' &&
    object.from.kind === 'object' &&
    object.to.kind === 'object' &&
    !isPresent(object.from.objectId) &&
    !isPresent(object.to.objectId)
  );
}

/**
 * A view that reads each object of `board` once: a plan never writes, so the board cannot change
 * while it runs.
 *
 * @param board - The board now.
 * @returns The same view, remembering each object read.
 */
function readingOnce(board: RepairView): RepairView {
  const read = new Map<ObjectId, BoardObject | undefined>();
  return {
    get: (id) => {
      if (!read.has(id)) read.set(id, board.get(id));
      return read.get(id);
    },
    isPresent: (id) => board.isPresent(id),
  };
}

/**
 * Plans the repair of every reference a change left pointing at an object that is not on the
 * board, or children of a parent that became a leaf (see above). Candidates are the change's
 * touched objects and their affected dependents, so the cost follows the change, not the board.
 * Reads only, and each object once: a store transaction's `get` decodes from Yjs on every call,
 * which made a 10k undo's plans cost 215 ms. Idempotent: on a board the plan has been
 * applied to, the same call plans nothing.
 *
 * @param board - The board now.
 * @param before - The board with removed objects as they were last seen (`LastKnownBoard`); its
 *   indexes find the removed objects' dependents and its lookups give their geometry.
 * @param touched - The objects the change created, changed or removed.
 * @returns The objects to rewrite and the connectors to delete.
 */
export function planReferenceRepair(
  board: RepairView,
  before: BoardReader,
  touched: Iterable<ObjectId>,
): ReferenceRepairPlan {
  const now = readingOnce(board);
  const isPresent = (id: ObjectId): boolean => now.isPresent(id);
  const isParent = (id: ObjectId): boolean => isPresent(id) && !isLeaf(now.get(id));
  const dangling = new Map<ObjectId, BoardObject>();
  const missing = new Set<ObjectId>();
  for (const id of candidatesOf(now, before, touched)) {
    const object = now.get(id);
    const gone = object === undefined ? [] : referencesOf(object).filter((ref) => !isPresent(ref));
    const hasInvalidParent = object?.parentId != null && !isParent(object.parentId);
    if (object === undefined || (gone.length === 0 && !hasInvalidParent)) continue;
    dangling.set(id, object);
    for (const ref of gone) missing.add(ref);
  }
  if (dangling.size === 0) return NOTHING_TO_REPAIR;
  const deleted = [...dangling.values()].filter((object) => isStranded(object, isPresent));
  for (const { id } of deleted) {
    dangling.delete(id);
    missing.add(id);
    for (const commentId of before.references.commentsAnchoredTo(id)) {
      const comment = now.get(commentId);
      if (comment !== undefined) dangling.set(commentId, comment);
    }
  }
  const survivors = [...dangling.values()].sort((first, second) =>
    compareKeys(first.id, second.id),
  );
  const rerooted = detachFromMissing(before, survivors, missing).map((object) =>
    // A present leaf remains a valid connector target and comment anchor: only its children
    // move, measured through its existing frame so their world placement stays unchanged.
    reroot(object, before, isParent),
  );
  const parents = new Map(survivors.map((object) => [object.id, object.parentId]));
  const updated = placeOnTop(rerooted, parents, before);
  return { updated, deleted: deleted.map(({ id }) => id).sort() };
}

/**
 * Writes a repair plan: deletes the stranded connectors, then rewrites the repaired objects
 * (`setObject` on an existing object writes only the fields that changed). An object whose
 * repaired value the store refuses (a field a peer wrote without validation, which `applyUpdate`
 * does not check) is left as it is: the store validates before it writes, so the refusal writes
 * nothing, and the rest of the repair goes ahead.
 *
 * @param transaction - The open transaction.
 * @param plan - The plan, from {@link planReferenceRepair} on the same board.
 * @returns The ids written or deleted, sorted.
 * @throws {unknown} Any error of a write other than the store's refusal of an invalid object.
 */
export function applyReferenceRepair(
  transaction: DocumentTransaction,
  plan: ReferenceRepairPlan,
): ObjectId[] {
  const written = plan.deleted.filter((id) => transaction.deleteObject(id));
  for (const object of plan.updated) {
    try {
      transaction.setObject(object);
      written.push(object.id);
    } catch (error) {
      // Validation is left to the write, which does it anyway: validating every repaired object
      // beforehand as well doubled the cost of a large repair (reference-repair.bench.ts).
      if (!(error instanceof DocumentWriteError)) throw error;
    }
  }
  return written.sort();
}

/**
 * Whether a plan writes nothing.
 *
 * @param plan - The plan.
 * @returns `true` when there is nothing to repair.
 */
export function isEmptyRepair(plan: ReferenceRepairPlan): boolean {
  return plan.updated.length === 0 && plan.deleted.length === 0;
}
