import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  clipChainOf,
  clipRectOf,
  type ClipChainMemo,
  type ClipRect,
} from '../spatial/clip-chain.js';

import { ClipTable } from './clip-table.js';
import type { SceneSource } from './scene-source.js';

/**
 * The scene's clip bookkeeping: each mirrored object's clip index (the clip table slot
 * of its nearest clipping ancestor, never itself; 0 for none), which every scene pass record
 * carries in its trailing float, and the {@link ClipTable} records of the clipping frames those
 * indices name. A frame's record is worked out at most once per `Scene.apply` (its epoch), on
 * first use by any object, so children resolve whether they come before or after their frame in
 * the change set; a frame that changes rewrites its record, and one that stops clipping, is
 * deleted or becomes undrawable releases it. Descendants of a changed frame are rewritten by the
 * scene anyway (`refreshDescendants`), so their indices follow. CPU-only, owned by the `Scene`.
 */
export class SceneClips {
  /** The clip table the scene's records index. */
  readonly table = new ClipTable();
  private readonly indexById = new Map<ObjectId, number>();
  private readonly epochById = new Map<ObjectId, number>();
  private readonly memo: ClipChainMemo = new Map();
  /** The frames that clip, virtual ones included, so a board without one walks no ancestors. */
  private readonly clippingFrames = new Set<ObjectId>();
  private epoch = 0;

  /** Starts a new document state: chains and frame records are worked out afresh, once each. */
  beginApply(): void {
    this.epoch += 1;
    if (this.memo.size > 0) this.memo.clear();
  }

  /**
   * Notes whether an object of a change set is a frame that clips, before any of the set's
   * objects are upserted, so a child listed before its clipping frame is still clipped, and a
   * board's first clipping frame turns the ancestor walk on (its descendants are rewritten as
   * descendants of a changed object). Its last one turns the walk off, and the same rewrite sets
   * their indices to 0.
   *
   * @param id - The object.
   * @param object - The object now, or undefined when it is gone.
   */
  noteFrame(id: ObjectId, object: BoardObject | undefined): void {
    if (object?.type === 'frame' && object.clip) this.clippingFrames.add(id);
    else this.clippingFrames.delete(id);
  }

  /**
   * An object's clip index as last worked out by {@link SceneClips.update}.
   *
   * @param id - The object.
   * @returns Its nearest clipping ancestor's slot, or 0.
   */
  indexOf(id: ObjectId): number {
    return this.indexById.get(id) ?? 0;
  }

  /**
   * Brings an object's clip index, and its own clip record when it is a clipping frame with
   * one, up to date with the document. Called for every object the scene upserts.
   *
   * @param object - The object as the document holds it now; not mutated.
   * @param source - The document, for its ancestors.
   * @returns Its clip index.
   */
  update(object: BoardObject, source: SceneSource): number {
    if (this.table.slotOf(object.id) !== 0) {
      const rect = clipRectOf(object, source);
      if (rect === undefined) this.release(object.id);
      else this.ensure(rect, source);
    }
    // Root objects, most of a board, and every object of a board with no clipping frame skip
    // the walk (and allocate nothing).
    const nearest =
      object.parentId === null || this.clippingFrames.size === 0
        ? undefined
        : clipChainOf(object, source, this.memo)[0];
    const index = nearest === undefined ? 0 : this.ensure(nearest, source);
    if (index === 0) this.indexById.delete(object.id);
    else this.indexById.set(object.id, index);
    return index;
  }

  /**
   * Forgets a removed object: its index and, for a clipping frame, its record.
   *
   * @param id - The object.
   */
  remove(id: ObjectId): void {
    this.indexById.delete(id);
    this.clippingFrames.delete(id);
    this.release(id);
  }

  private release(id: ObjectId): void {
    this.table.release(id);
    this.epochById.delete(id);
  }

  /**
   * A clipping frame's slot, writing its record and its clipping ancestors' when this document
   * state has not written them yet; ancestors first, so each record can name its parent's slot.
   *
   * @param rect - The frame's box.
   * @param source - The document.
   * @returns Its slot.
   */
  private ensure(rect: ClipRect, source: SceneSource): number {
    const pending: ClipRect[] = [];
    const seen = new Set<ObjectId>();
    let current: ClipRect | undefined = rect;
    while (current !== undefined && this.epochById.get(current.id) !== this.epoch) {
      if (seen.has(current.id)) {
        current = undefined;
        break;
      }
      seen.add(current.id);
      pending.push(current);
      const frame = source.get(current.id);
      current = frame === undefined ? undefined : clipChainOf(frame, source, this.memo)[0];
    }
    let parent = current;
    let slot = current === undefined ? 0 : this.table.slotOf(current.id);
    for (let index = pending.length - 1; index >= 0; index--) {
      const frame = pending[index];
      if (frame === undefined) continue;
      slot = this.table.set(frame, parent, slot);
      this.epochById.set(frame.id, this.epoch);
      parent = frame;
    }
    return slot;
  }
}
