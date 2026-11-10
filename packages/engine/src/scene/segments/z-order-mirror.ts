import type { BoardObject, ObjectId } from '@canvas/schema';

import { ownOpacityOf } from '../layers/layer-form.js';
import { isRootMoveChanges } from '../root-move-changes.js';
import type { ScenePass } from '../scene-pass.js';
import type { SceneChangeSet } from '../scene-source.js';

import { isLonePlaceKept, SiblingLists, type SiblingChange } from './sibling-lists.js';

/**
 * The most objects edited in the middle of the paint order (`ZOrderMirror.editedIds`) between two
 * refreshes of its tables: past it, the order is walked again instead (a large paste).
 */
export const MAX_ORDER_EDITS = 256;

/**
 * The document as z-order segments need it: every object the scene mirrors (for its `z`,
 * parent and occluder flag), fed the same change sets as the scene, and which derived tables
 * a change set made stale. Changes that only move, resize or recolour objects stale no table
 * (they are listed in `updatedIds`, which matter only to a plan that merged segments by boxes), so
 * a drag or a camera move rebuilds nothing. CPU-only; the frame's thread.
 */
export class ZOrderMirror {
  /**
   * Whether a `z` key, a parent, the set of objects or an object's closing rank
   * (`hasClosingRank`) changed: the paint order is stale.
   */
  isOrderDirty = false;
  /**
   * Whether an object started or stopped being an occluder at its own or its closing rank
   * (`occluderState`); the table is also rebuilt with the order.
   */
  isOccludersDirty = false;
  /** Whether a pass started or stopped drawing an object, or changed its record count. */
  isSlotsDirty = false;
  /**
   * The existing objects whose record count changed in some pass: with the order
   * unchanged, only their slots need rewriting in the slot-owner tables.
   */
  readonly slotChangedIds = new Set<ObjectId>();
  /** Whether an object's own opacity went to 0 or came back from it. */
  isVisibilityDirty = false;
  /**
   * The objects created since the tables were rebuilt that paint last, bottom first, while the
   * paint order is otherwise unchanged (a stroke committed, a sticky placed): each a
   * root with no children and no closing rank, together the end of the root list. The order is
   * then that order plus these (`ZOrderSegments` appends them when its last walk reached every
   * object from the roots); other changes are `editedIds` or set `isOrderDirty`.
   */
  readonly appendedIds: ObjectId[] = [];
  /**
   * The objects deleted since the tables were rebuilt from the end of the paint order, bottom
   * first, while it is otherwise unchanged (a stroke's preview, removed as the stroke
   * is committed): each a childless root without a closing rank, together the end of the root
   * list then. The order drops them before `appendedIds` are appended; one appended this frame
   * and deleted again leaves neither list.
   */
  readonly trimmedIds: ObjectId[] = [];
  /**
   * The leaf objects created, deleted, reparented or restacked out of place since the tables were
   * rebuilt, anywhere in the paint order, while it is otherwise unchanged (a sticky placed
   * in a section, a stroke committed into one). Each had no children and no closing rank when it
   * changed, and its parent is a mirrored object or none. The order then loses the ranks these
   * held and takes those they hold now (`editedOrder`); at most {@link MAX_ORDER_EDITS}, else
   * `isOrderDirty`. Once one is recorded, edits at the end are recorded here too, not in
   * `appendedIds` and `trimmedIds`.
   */
  readonly editedIds = new Set<ObjectId>();
  /** The objects whose own opacity is 0: nothing of them or under them draws, yet they hit. */
  readonly invisibleIds = new Set<ObjectId>();
  /**
   * The existing objects that changed at all since the tables were rebuilt (they may have moved
   * or resized): a plan that merged segments by their boxes is checked against them.
   */
  readonly updatedIds = new Set<ObjectId>();
  /** Every parent's children in stacking order, kept sorted as change sets arrive. */
  readonly siblings = new SiblingLists();
  private readonly byId = new Map<ObjectId, BoardObject>();

  /**
   * How many objects are mirrored; equals `Scene.objectCount` when both see every change set.
   *
   * @returns The count.
   */
  get objectCount(): number {
    return this.byId.size;
  }

  /**
   * The mirrored objects, in no particular order.
   *
   * @returns An iterator over them.
   */
  objects(): IterableIterator<BoardObject> {
    return this.byId.values();
  }

  /**
   * Reads a mirrored object.
   *
   * @param id - The object id.
   * @returns The object as of the last change set, or `undefined` when none has that id.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.byId.get(id);
  }

  /**
   * Whether any pass draws an object as an occluder (`ScenePass.isOccluder`).
   *
   * @param object - The object.
   * @param passes - The scene's passes.
   * @returns Whether it occludes.
   */
  isOccluder(object: BoardObject, passes: readonly ScenePass[]): boolean {
    for (const pass of passes) if (pass.isOccluder?.(object) === true) return true;
    return false;
  }

  /**
   * An object's occluder flags as the paint ranks hold them: bit 0 when a pass drawn
   * at its own rank flags it, bit 1 when a pass drawn after its descendants (at its closing rank)
   * does. The z-order segments keep the two apart (`occludersByRank`), so a change to either one
   * stales the table even when the other keeps the combined flag the same (a stroked frame given
   * a background or a shadow).
   *
   * @param object - The object.
   * @param passes - The scene's passes.
   * @returns The two flags, as bits.
   */
  occluderState(object: BoardObject, passes: readonly ScenePass[]): number {
    let state = 0;
    for (const pass of passes) {
      if (pass.isOccluder?.(object) !== true) continue;
      state |= pass.isDrawnAfterDescendants === true ? 2 : 1;
    }
    return state;
  }

  /**
   * Whether a pass draws an object after its descendants (`ScenePass.isDrawnAfterDescendants`),
   * so the object has a closing paint rank (a stroked frame).
   *
   * @param object - The object.
   * @param passes - The scene's passes.
   * @returns Whether it has a closing rank.
   */
  hasClosingRank(object: BoardObject, passes: readonly ScenePass[]): boolean {
    for (const pass of passes) {
      if (pass.isDrawnAfterDescendants === true && pass.recordCount(object) > 0) return true;
    }
    return false;
  }

  /**
   * Applies a change set the way `Scene.apply` does (each listed id read through `get`: present
   * is created or updated, absent is removed) and marks what it made stale. Call it with every
   * change set the scene applies, before or after the scene, and never skip one.
   *
   * @param changes - The change set; read, never mutated.
   * @param passes - The scene's passes, for record counts and occluder flags.
   */
  observe(changes: SceneChangeSet, passes: readonly ScenePass[]): void {
    const isRootMove = isRootMoveChanges(changes);
    const isOccluderStateStable =
      isRootMove && passes.every((pass) => pass.isRootMoveOrderStable === true);
    const moves: SiblingChange[] = [];
    const created: BoardObject[] = [];
    const removed: BoardObject[] = [];
    // A z key changed under the same parent: the order is stale unless the object keeps its place.
    const restacked: [previous: BoardObject, next: BoardObject][] = [];
    // Moved to another parent or place: edits of the order when they are leaves.
    const moved: BoardObject[] = [];
    for (const id of new Set([...changes.created, ...changes.updated, ...changes.deleted])) {
      const next = changes.get(id);
      const previous = this.byId.get(id);
      if (!next) {
        if (previous) {
          this.byId.delete(id);
          this.noteVisibility(id, false);
          moves.push([previous, undefined]);
          removed.push(previous);
        }
        continue;
      }
      this.byId.set(id, next);
      this.noteVisibility(id, ownOpacityOf(next) === 0);
      if (!previous) {
        moves.push([undefined, next]);
        created.push(next);
        continue;
      }
      if (previous.z !== next.z || previous.parentId !== next.parentId) {
        moves.push([previous, next]);
        if (previous.parentId === next.parentId) restacked.push([previous, next]);
        else moved.push(next);
        // Its closing rank would move too: not an edit of the order.
        if (this.hasClosingRank(previous, passes)) this.isOrderDirty = true;
      }
      if (
        !isOccluderStateStable &&
        this.occluderState(previous, passes) !== this.occluderState(next, passes)
      ) {
        this.isOccludersDirty = true;
      }
      // A closing rank came or went (a frame's outline given or taken away): ranks shift.
      if (
        !isOccluderStateStable &&
        this.hasClosingRank(previous, passes) !== this.hasClosingRank(next, passes)
      ) {
        this.isOrderDirty = true;
        this.isSlotsDirty = true;
      }
      for (const pass of passes) {
        if (isRootMove && pass.isRootMoveOrderStable === true) continue;
        if (pass.recordCount(previous) === pass.recordCount(next)) continue;
        this.isSlotsDirty = true;
        this.slotChangedIds.add(id);
        break;
      }
      this.updatedIds.add(id);
    }
    const isPlaceKept = isLonePlaceKept(this.siblings, restacked, moves);
    if (!isPlaceKept) moved.push(...restacked.map(([, next]) => next));
    if (removed.length > 0) this.noteRemoved(removed, passes);
    this.siblings.replaceAll(moves);
    if (moved.length > 0) {
      // Moved to another parent or place: their slots take their new ranks, as edits (leaves).
      this.isSlotsDirty = true;
      for (const { id } of moved) this.slotChangedIds.add(id);
      if (this.isEditable(moved, passes)) this.noteEdited(moved);
      else this.markObjectsChanged();
    }
    if (created.length > 0) this.noteCreated(created, passes);
  }

  /**
   * Whether objects are leaves without closing ranks under a parent the paint order holds (or
   * none), as the sibling lists stand: each then changes the order at its own rank alone, an edit
   * `editedOrder` can splice.
   *
   * @param objects - The objects, as they are now.
   * @param passes - The scene's passes.
   * @returns Whether every one is.
   */
  private isEditable(objects: readonly BoardObject[], passes: readonly ScenePass[]): boolean {
    return objects.every(
      (object) =>
        this.siblings.childrenOf(object.id).length === 0 &&
        !this.hasClosingRank(object, passes) &&
        (object.parentId === null ||
          (object.parentId !== object.id && this.byId.has(object.parentId))),
    );
  }

  /**
   * Records edits in the middle of the paint order (`editedIds`), taking in the end edits recorded
   * before them; past {@link MAX_ORDER_EDITS} the order is stale instead.
   *
   * @param objects - The edited objects.
   */
  private noteEdited(objects: readonly BoardObject[]): void {
    if (this.isOrderDirty) return;
    for (const id of [...this.appendedIds, ...this.trimmedIds]) this.editedIds.add(id);
    this.appendedIds.length = 0;
    this.trimmedIds.length = 0;
    for (const { id } of objects) this.editedIds.add(id);
    if (this.editedIds.size > MAX_ORDER_EDITS) this.markObjectsChanged();
  }

  /**
   * Records objects about to leave (still in the sibling lists): as trimmed from the end of the
   * paint order when they are the end of the root list, childless and without closing ranks, and
   * the order is otherwise unchanged; else the order is stale. Either way their passes' slots go
   * (`slotChangedIds`, read before the scene applies the change set).
   *
   * @param removed - The removed objects, as the lists hold them.
   * @param passes - The scene's passes.
   */
  private noteRemoved(removed: readonly BoardObject[], passes: readonly ScenePass[]): void {
    this.isSlotsDirty = true;
    for (const { id } of removed) this.slotChangedIds.add(id);
    const roots = this.siblings.childrenOf(null);
    const tail = roots.slice(roots.length - removed.length).map(({ id }) => id);
    const ids = new Set(removed.map(({ id }) => id));
    const isTrimmed =
      !this.isOrderDirty &&
      this.editedIds.size === 0 &&
      tail.length === removed.length &&
      tail.every((id) => ids.has(id)) &&
      removed.every(
        (object) =>
          object.parentId === null &&
          this.siblings.childrenOf(object.id).length === 0 &&
          !this.hasClosingRank(object, passes),
      );
    if (!isTrimmed) {
      if (this.isEditable(removed, passes)) this.noteEdited(removed);
      else this.markObjectsChanged();
      return;
    }
    // Top first: what this frame appended goes first, then the order's own end.
    for (const id of tail.reverse()) {
      if (this.appendedIds.at(-1) === id) this.appendedIds.pop();
      else this.trimmedIds.unshift(id);
    }
  }

  /**
   * Records objects just created (and already in the sibling lists): as appended to the paint
   * order when they are the end of the root list, childless and without closing ranks, and the
   * order is otherwise unchanged; else the order is stale. Either way their passes' slots are
   * new (`slotChangedIds`).
   *
   * @param created - The created objects.
   * @param passes - The scene's passes.
   */
  private noteCreated(created: readonly BoardObject[], passes: readonly ScenePass[]): void {
    this.isSlotsDirty = true;
    for (const { id } of created) this.slotChangedIds.add(id);
    const roots = this.siblings.childrenOf(null);
    const tail = roots.slice(roots.length - created.length).map(({ id }) => id);
    const ids = new Set(created.map(({ id }) => id));
    const isAppended =
      !this.isOrderDirty &&
      this.editedIds.size === 0 &&
      tail.length === created.length &&
      tail.every((id) => ids.has(id)) &&
      created.every(
        (object) =>
          object.parentId === null &&
          this.siblings.childrenOf(object.id).length === 0 &&
          !this.hasClosingRank(object, passes),
      );
    if (isAppended) this.appendedIds.push(...tail);
    else if (this.isEditable(created, passes)) this.noteEdited(created);
    else this.markObjectsChanged();
  }

  /**
   * Keeps `invisibleIds` in step with one object.
   *
   * @param id - The object.
   * @param isInvisible - Whether its own opacity is 0 now (false once deleted).
   */
  private noteVisibility(id: ObjectId, isInvisible: boolean): void {
    if (isInvisible === this.invisibleIds.has(id)) return;
    if (isInvisible) this.invisibleIds.add(id);
    else this.invisibleIds.delete(id);
    this.isVisibilityDirty = true;
  }

  /** Forgets what was stale: call once the derived tables are rebuilt. */
  clearDirty(): void {
    this.isVisibilityDirty = false;
    this.isOrderDirty = false;
    this.isOccludersDirty = false;
    this.isSlotsDirty = false;
    this.slotChangedIds.clear();
    this.updatedIds.clear();
    this.appendedIds.length = 0;
    this.trimmedIds.length = 0;
    this.editedIds.clear();
  }

  /** An object arrived or left: ranks shift, so every table is stale (occluders follow ranks). */
  private markObjectsChanged(): void {
    this.isOrderDirty = true;
    this.isSlotsDirty = true;
    this.appendedIds.length = 0;
    this.trimmedIds.length = 0;
    this.editedIds.clear();
  }

  /**
   * Objects and everything under them: a moved frame moves its children's boxes too.
   *
   * @param ids - The objects.
   * @yields {ObjectId} Each object, then its descendants, depth first.
   */
  *withDescendants(ids: Iterable<ObjectId>): Generator<ObjectId> {
    for (const id of ids) {
      yield id;
      yield* this.withDescendants(this.siblings.childrenOf(id).map(({ id: child }) => child));
    }
  }
}
