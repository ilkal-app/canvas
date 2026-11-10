// One pass's drawn slots kept in typed arrays by dense object handle: the camera path's
// replacement for `VisibleSlotPass`. Per changed object it reads the object's handle once and then
// only typed tables: the scene's slot revision by handle (`Scene.handles`) against the revision
// this pass last drew, and the drawn slots as first slot and count. An object's slots are copied
// or unmarked only when that revision changes; equal revisions prove the scene's slot array is the
// same. The rare object whose slots are not consecutive keeps a copied array in a side map.
import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import type { Scene } from '../scene/scene.js';

import { BridgedSlots } from './bridged-slots.js';
import { coalesceMarkedSlots } from './visible-ranges.js';

/** No drawn slots under a handle. */
const NONE = -1;

/** What a table pass reads from the scene. */
type VisibleSlotTableSource = Pick<Scene, 'handles' | 'instanceBufferOf'>;

/**
 * Objects whose visibility or slots may have changed, resolved once for every pass:
 * each id with its handle and whether it is in the visible membership.
 */
export interface ResolvedTouched {
  /** The ids. */
  readonly ids: readonly ObjectId[];
  /** Each id's handle. */
  readonly handles: readonly number[];
  /** 1 for each id in the visible membership. */
  readonly isMember: Uint8Array;
  /** The visible membership. */
  readonly members: ReadonlySet<ObjectId>;
}

/** One pass's drawn slots, by dense object handle. */
export class VisibleSlotTable {
  private slots: BridgedSlots;
  private source: VisibleSlotTableSource | undefined;
  /** The slot revision each handle was last drawn at; 0 when it is not drawn. */
  private drawnRevision = new Uint32Array(0);
  /** Each drawn handle's first slot, or `NONE` for none or a scattered set. */
  private firstSlot = new Int32Array(0);
  /** Each drawn handle's slot count, when they are consecutive from `firstSlot`. */
  private slotCount = new Int32Array(0);
  /** The drawn slots of handles whose slots are not consecutive. */
  private readonly scattered = new Map<number, readonly number[]>();
  /** Handles waiting to be marked after this update's unmarks, reused across updates. */
  private pending: number[] = [];
  private change: CullRangeChange;

  /**
   * Starts an empty pass.
   *
   * @param maxGap - The greatest gap drawn through.
   */
  constructor(private readonly maxGap: number) {
    this.slots = new BridgedSlots(maxGap);
    this.change = { source: this, revision: 0, previousRevision: -1, added: [], removed: [] };
  }

  /**
   * Patches changed objects, unmarking every changed object's old slots before marking any new
   * ones, so a slot reassigned in the same scene change is never cleared.
   *
   * @param scene - The current scene.
   * @param passIndex - This pass's index (`Scene.handles.passIndexOf`).
   * @param name - This pass's name.
   * @param members - Current visible object membership.
   * @param hidden - The objects level of detail leaves out of this pass.
   * @param touched - Groups of ids whose visibility, hidden state or slots may have changed; an id
   *   may appear more than once.
   * @returns The most recent actual drawn-coverage change.
   */
  update(
    scene: VisibleSlotTableSource,
    passIndex: number,
    name: string,
    members: ReadonlySet<ObjectId>,
    hidden: ReadonlySet<ObjectId>,
    touched: readonly Iterable<ObjectId>[],
  ): CullRangeChange {
    if (this.source !== scene) return this.initialize(scene, passIndex, name, members, hidden);
    this.pending.length = 0;
    this.touchIds(scene, passIndex, members, hidden, touched);
    return this.finishUpdate(scene, passIndex);
  }

  /**
   * Patches changed objects as `update` does, for objects resolved once for every pass:
   * an object that neither holds slots in this pass nor was drawn in it is passed over before any
   * set is read, so a frame's visibility changes cost a lookup each, not one per pass.
   *
   * @param scene - The current scene.
   * @param passIndex - This pass's index (`Scene.handles.passIndexOf`).
   * @param name - This pass's name.
   * @param touched - The objects whose visibility or slots may have changed, resolved.
   * @param hidden - The objects level of detail leaves out of this pass.
   * @param extra - More ids for this pass alone (its level-of-detail changes), as in `update`.
   * @returns The precise drawn-slot delta.
   */
  updateResolved(
    scene: VisibleSlotTableSource,
    passIndex: number,
    name: string,
    touched: ResolvedTouched,
    hidden: ReadonlySet<ObjectId>,
    extra: readonly Iterable<ObjectId>[],
  ): CullRangeChange {
    const { members } = touched;
    if (this.source !== scene) return this.initialize(scene, passIndex, name, members, hidden);
    const { handles } = scene;
    this.pending.length = 0;
    const { ids, handles: resolved, isMember } = touched;
    for (let index = 0; index < resolved.length; index += 1) {
      const handle = resolved[index] ?? 0;
      const held = handles.revisionOf(handle, passIndex);
      const drawn = this.revisionAt(handle);
      if (held === 0 && drawn === 0) continue;
      const id = ids[index];
      const isVisible = held !== 0 && isMember[index] === 1 && id !== undefined && !hidden.has(id);
      this.touch(handle, isVisible ? held : 0, drawn);
    }
    this.touchIds(scene, passIndex, members, hidden, extra);
    return this.finishUpdate(scene, passIndex);
  }

  private touchIds(
    scene: VisibleSlotTableSource,
    passIndex: number,
    members: ReadonlySet<ObjectId>,
    hidden: ReadonlySet<ObjectId>,
    touched: readonly Iterable<ObjectId>[],
  ): void {
    const { handles } = scene;
    for (const ids of touched) {
      for (const id of ids) {
        const handle = handles.handleOf(id);
        if (handle === undefined) continue;
        const isVisible = members.has(id) && !hidden.has(id);
        this.touch(
          handle,
          isVisible ? handles.revisionOf(handle, passIndex) : 0,
          this.revisionAt(handle),
        );
      }
    }
  }

  /**
   * Moves one handle to the revision it should be drawn at, 0 for none: unmarks its old slots now
   * and queues its new ones, so a slot reassigned in the same update is never cleared.
   *
   * @param handle - The handle.
   * @param revision - The slot revision to draw it at, or 0.
   * @param drawn - The revision it is drawn at now, or 0.
   */
  private touch(handle: number, revision: number, drawn: number): void {
    if (drawn === revision) return;
    if (drawn !== 0) this.unmark(handle);
    if (revision !== 0) {
      this.reserve(handle);
      this.drawnRevision[handle] = revision;
      this.pending.push(handle);
    }
  }

  private finishUpdate(scene: VisibleSlotTableSource, passIndex: number): CullRangeChange {
    const { handles } = scene;
    for (const handle of this.pending) this.mark(handle, handles.slotsOf(handle, passIndex) ?? []);
    const patch = this.slots.finish();
    if (patch.added.length || patch.removed.length) {
      const previousRevision = this.change.revision;
      this.change = { source: this, revision: previousRevision + 1, previousRevision, ...patch };
    }
    return this.change;
  }

  /**
   * Reads finished drawn ranges.
   *
   * @returns The retained immutable range snapshot.
   */
  get ranges(): readonly InstanceRange[] {
    return this.slots.ranges;
  }

  /**
   * Reads the bounded coverage change.
   *
   * @returns The last change; missed revisions require a full reset.
   */
  get latestChange(): CullRangeChange {
    return this.change;
  }

  private revisionAt(handle: number): number {
    return this.drawnRevision[handle] ?? 0;
  }

  /**
   * Records a handle's drawn slots and marks them.
   *
   * @param handle - The handle, already given its drawn revision.
   * @param slots - Its slots in this pass, record 0 first.
   */
  private mark(handle: number, slots: readonly number[]): void {
    this.reserve(handle);
    const first = slots[0];
    if (first === undefined) {
      this.drawnRevision[handle] = 0;
      return;
    }
    let isConsecutive = true;
    for (let index = 1; index < slots.length; index++) {
      if (slots[index] !== first + index) {
        isConsecutive = false;
        break;
      }
    }
    if (isConsecutive) {
      this.firstSlot[handle] = first;
      this.slotCount[handle] = slots.length;
      this.slots.setRange({ start: first, count: slots.length }, true);
    } else {
      this.firstSlot[handle] = NONE;
      const copy = slots.slice();
      this.scattered.set(handle, copy);
      this.setScattered(copy, true);
    }
  }

  /**
   * Unmarks a drawn handle's slots and forgets them.
   *
   * @param handle - The drawn handle.
   */
  private unmark(handle: number): void {
    const first = this.firstSlot[handle] ?? NONE;
    if (first !== NONE) {
      this.slots.setRange({ start: first, count: this.slotCount[handle] ?? 0 }, false);
    } else {
      const slots = this.scattered.get(handle);
      if (slots !== undefined) this.setScattered(slots, false);
      this.scattered.delete(handle);
    }
    this.drawnRevision[handle] = 0;
    this.firstSlot[handle] = NONE;
  }

  /**
   * Marks or unmarks scattered slots as runs.
   *
   * @param slots - The slots.
   * @param isMarked - Whether to mark them.
   */
  private setScattered(slots: readonly number[], isMarked: boolean): void {
    let start = 0;
    let count = 0;
    for (const slot of slots) {
      if (count > 0 && slot === start + count) {
        count++;
        continue;
      }
      if (count > 0) this.slots.setRange({ start, count }, isMarked);
      start = slot;
      count = 1;
    }
    if (count > 0) this.slots.setRange({ start, count }, isMarked);
  }

  /**
   * Grows the tables to hold a handle.
   *
   * @param handle - The handle.
   */
  private reserve(handle: number): void {
    if (handle < this.firstSlot.length && handle < this.drawnRevision.length) return;
    const size = Math.max(64, (handle + 1) * 2);
    const revisions = new Uint32Array(size);
    revisions.set(this.drawnRevision);
    this.drawnRevision = revisions;
    const firsts = new Int32Array(size).fill(NONE);
    firsts.set(this.firstSlot);
    this.firstSlot = firsts;
    const counts = new Int32Array(size);
    counts.set(this.slotCount);
    this.slotCount = counts;
  }

  private initialize(
    scene: VisibleSlotTableSource,
    passIndex: number,
    name: string,
    members: ReadonlySet<ObjectId>,
    hidden: ReadonlySet<ObjectId>,
  ): CullRangeChange {
    const previousRevision = this.change.revision;
    const removed = this.slots.ranges;
    this.drawnRevision = new Uint32Array(0);
    this.firstSlot = new Int32Array(0);
    this.slotCount = new Int32Array(0);
    this.scattered.clear();
    const { handles } = scene;
    // Construction stays linear even when R-tree ids arrive in arbitrary slot order: mark, then
    // coalesce once.
    const marks = new Uint8Array(scene.instanceBufferOf(name).recordCount);
    for (const id of members) {
      if (hidden.has(id)) continue;
      const handle = handles.handleOf(id);
      if (handle === undefined) continue;
      const revision = handles.revisionOf(handle, passIndex);
      const slots = handles.slotsOf(handle, passIndex);
      if (revision === 0 || slots === undefined || slots.length === 0) continue;
      this.reserve(handle);
      this.drawnRevision[handle] = revision;
      this.record(handle, slots);
      for (const slot of slots) marks[slot] = 1;
    }
    this.slots = new BridgedSlots(this.maxGap, coalesceMarkedSlots(marks, 0));
    this.source = scene;
    this.change = {
      source: this,
      revision: previousRevision + 1,
      previousRevision,
      added: this.slots.ranges,
      removed,
    };
    return this.change;
  }

  /**
   * Records a handle's drawn slots without marking them (construction marks in bulk).
   *
   * @param handle - The handle, reserved.
   * @param slots - Its slots, at least one.
   */
  private record(handle: number, slots: readonly number[]): void {
    const first = slots[0] ?? NONE;
    for (let index = 1; index < slots.length; index++) {
      if (slots[index] !== first + index) {
        this.firstSlot[handle] = NONE;
        this.scattered.set(handle, slots.slice());
        return;
      }
    }
    this.firstSlot[handle] = first;
    this.slotCount[handle] = slots.length;
  }
}
