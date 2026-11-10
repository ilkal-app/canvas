import type { InstanceRange } from '../scene/scene-culler.js';

import { RangePatchBuilder, type RangePatch } from './range-patch.js';
import { SparseRanges } from './sparse-ranges.js';

/** Exact marked intervals plus local gap-bridged drawn intervals, without a full slot scan. */
export class BridgedSlots {
  private readonly marked: SparseRanges;
  private readonly drawn: SparseRanges;
  private patch = new RangePatchBuilder();
  private output: readonly InstanceRange[] = [];

  /**
   * Creates a marked set in one ordered pass.
   *
   * @param maxGap - The greatest unmarked gap drawn through.
   * @param initial - Sorted, disjoint exact marked intervals for a full reset.
   */
  constructor(
    private readonly maxGap: number,
    initial: readonly InstanceRange[] = [],
  ) {
    this.marked = new SparseRanges(initial);
    const bridged: InstanceRange[] = [];
    for (const range of initial) {
      const previous = bridged.at(-1);
      if (previous && range.start - previous.start - previous.count <= maxGap) {
        bridged[bridged.length - 1] = {
          start: previous.start,
          count: range.start + range.count - previous.start,
        };
      } else bridged.push(range);
    }
    this.drawn = new SparseRanges(bridged);
    this.output = this.drawn.values();
  }

  /**
   * Reads the last finished frame's ranges.
   *
   * @returns Immutable ranges retained while final coverage is unchanged.
   */
  get ranges(): readonly InstanceRange[] {
    return this.output;
  }

  /**
   * Changes one marked slot and only its neighboring bridges.
   *
   * @param slot - The slot to mark or unmark.
   * @param isMarked - Its new membership.
   */
  set(slot: number, isMarked: boolean): void {
    if ((this.marked.containing(slot) !== undefined) === isMarked) return;
    if (isMarked) this.marked.add({ start: slot, count: 1 });
    else this.marked.remove({ start: slot, count: 1 });
    const previous = this.marked.before(slot);
    const next = this.marked.after(slot);
    if (isMarked) {
      const start = previous !== undefined && slot - previous - 1 <= this.maxGap ? previous : slot;
      const end = next !== undefined && next - slot - 1 <= this.maxGap ? next + 1 : slot + 1;
      this.patch.record(this.drawn.add({ start, count: end - start }), true);
    } else {
      if (previous !== undefined && next !== undefined && next - previous - 1 <= this.maxGap)
        return;
      const old = this.drawn.containing(slot);
      if (!old) return;
      const start = Math.max(old.start, previous === undefined ? old.start : previous + 1);
      const end = Math.min(old.start + old.count, next ?? old.start + old.count);
      this.patch.record(this.drawn.remove({ start, count: end - start }), false);
    }
  }

  /**
   * Changes a contiguous marked interval and repairs only its outside bridges.
   *
   * @param range - Consecutive owned slots whose membership changes together.
   * @param isMarked - Their new membership.
   */
  setRange(range: InstanceRange, isMarked: boolean): void {
    if (range.count <= 0) return;
    if (range.count === 1) {
      this.set(range.start, isMarked);
      return;
    }
    const changed = isMarked ? this.marked.add(range) : this.marked.remove(range);
    if (changed.length === 0) return;
    const end = range.start + range.count;
    const previous = this.marked.before(range.start);
    const next = this.marked.after(end - 1);
    if (isMarked) {
      const from =
        previous !== undefined && range.start - previous - 1 <= this.maxGap
          ? previous
          : range.start;
      const to = next !== undefined && next - end <= this.maxGap ? next + 1 : end;
      this.patch.record(this.drawn.add({ start: from, count: to - from }), true);
    } else {
      if (previous !== undefined && next !== undefined && next - previous - 1 <= this.maxGap)
        return;
      const from = previous === undefined ? range.start : previous + 1;
      const to = next ?? end;
      this.patch.record(this.drawn.remove({ start: from, count: to - from }), false);
    }
  }

  /**
   * Publishes the frame's final coverage and starts a new bounded patch.
   *
   * @returns Added/removed drawn intervals, including bridged unmarked slots.
   */
  finish(): RangePatch {
    const patch = this.patch.value();
    if (patch.added.length || patch.removed.length) this.output = this.drawn.values();
    this.patch = new RangePatchBuilder();
    return patch;
  }
}
