import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import type { Scene } from '../scene/scene.js';

import { BridgedSlots } from './bridged-slots.js';
import { coalesceMarkedSlots } from './visible-ranges.js';

/** Custom sources without ownership revisions keep exact slot-array comparison. */
type VisibleSlotSource = Pick<Scene, 'slotsOf' | 'instanceBufferOf' | 'levelOfDetail'> &
  Partial<Pick<Scene, 'slotRevisionOf'>>;

/** Owns one pass's marked slots and independent copies of their previous object ownership. */
export class VisibleSlotPass {
  private slots: BridgedSlots;
  private source: VisibleSlotSource | undefined;
  private readonly byId = new Map<ObjectId, readonly number[]>();
  private readonly revisions = new Map<ObjectId, number>();
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
   * Patches changed objects, removing old ownership before any slot can be reassigned.
   *
   * @param scene - The current scene.
   * @param name - This pass.
   * @param members - Current visible object membership.
   * @param touched - IDs whose visibility, hidden state or slots changed.
   * @returns The most recent actual drawn-coverage change.
   */
  update(
    scene: VisibleSlotSource,
    name: string,
    members: ReadonlySet<ObjectId>,
    touched: Iterable<ObjectId>,
  ): CullRangeChange {
    if (this.source !== scene) return this.initialize(scene, name, members);
    const hidden = scene.levelOfDetail.hiddenIn(name);
    const replacements = new Map<ObjectId, readonly number[]>();
    for (const id of touched) {
      const isVisible = members.has(id) && !hidden.has(id);
      const revision = isVisible ? scene.slotRevisionOf?.(id, name) : undefined;
      if (revision !== undefined && this.revisions.get(id) === revision) continue;
      if (revision === undefined) this.revisions.delete(id);
      else this.revisions.set(id, revision);
      const previous = this.byId.get(id) ?? [];
      const next = isVisible ? scene.slotsOf(id, name) : [];
      if (previous.length === next.length && previous.every((slot, index) => slot === next[index]))
        continue;
      this.setSlots(previous, false);
      replacements.set(id, next.slice());
    }
    for (const [id, next] of replacements) {
      this.setSlots(next, true);
      if (next.length) this.byId.set(id, next);
      else this.byId.delete(id);
    }
    const patch = this.slots.finish();
    if (patch.added.length || patch.removed.length) {
      const previousRevision = this.change.revision;
      this.change = { source: this, revision: previousRevision + 1, previousRevision, ...patch };
    }
    return this.change;
  }

  private setSlots(slots: readonly number[], isMarked: boolean): void {
    let start = slots[0];
    if (start === undefined) return;
    let count = 1;
    for (let index = 1; index < slots.length; index++) {
      const slot = slots[index];
      if (slot === undefined) continue;
      if (slot === start + count) {
        count++;
        continue;
      }
      this.slots.setRange({ start, count }, isMarked);
      start = slot;
      count = 1;
    }
    this.slots.setRange({ start, count }, isMarked);
  }

  private initialize(
    scene: VisibleSlotSource,
    name: string,
    members: ReadonlySet<ObjectId>,
  ): CullRangeChange {
    const previousRevision = this.change.revision;
    const removed = this.slots.ranges;
    this.byId.clear();
    this.revisions.clear();
    // Initial/reset construction stays linear even when R-tree IDs arrive in arbitrary slot order.
    const marks = new Uint8Array(scene.instanceBufferOf(name).recordCount);
    const hidden = scene.levelOfDetail.hiddenIn(name);
    for (const id of members) {
      if (hidden.has(id)) continue;
      const revision = scene.slotRevisionOf?.(id, name);
      if (revision !== undefined) this.revisions.set(id, revision);
      const slots = scene.slotsOf(id, name);
      if (slots.length === 0) continue;
      this.byId.set(id, slots.slice());
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
}
