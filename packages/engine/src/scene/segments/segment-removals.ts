import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import type { PassPageSpans } from './segment-pages.js';
import type { PlannedPass, SegmentPlan } from './segment-plan.js';
import { SlotEntryRanges } from './slot-entry-ranges.js';
import { subtractRanges } from './subtract-ranges.js';

/** Reads the culler's latest bounded change for one pass. */
export type SegmentRangeChanges = (passName: string) => CullRangeChange | undefined;

interface Cursor {
  readonly source: object;
  readonly revision: number;
}

interface EntryState {
  entry: DrawListEntry;
  remaining: number;
}

interface PassRecords {
  readonly entryOfSlot: Map<number, number> | SlotEntryRanges;
  readonly countByRank: Uint32Array;
}

interface PassState {
  readonly pass: PlannedPass;
  readonly index: number;
  readonly records: PassRecords | undefined;
  readonly span: PassPageSpans | undefined;
  cursor: Cursor | undefined;
}

interface PendingRemoval {
  readonly state: PassState;
  readonly cursor: Cursor;
  readonly ranges: readonly InstanceRange[];
}

/**
 * Patches only removals from a full plan. Boundaries stay conservative; additions and uncertain
 * revisions refuse the patch. Metadata is bounded by the current slots, ranks and full-plan
 * entries. Emitting a changed list still costs its entries, not just the removed records.
 */
export class SegmentRemovals {
  private readonly passes = new Map<string, PassState>();
  private readonly entries: EntryState[];
  private readonly ranksBySegment = new Map<number, number>();
  private reads = 0;

  /**
   * Takes ownership of a new full plan's mutable tables and snapshots the delta cursors.
   *
   * @param plan - The full planner's result.
   * @param passes - Its stable slot owners and page tables.
   * @param changes - The culler's borrowed changes.
   * @param slotsOfRank - One object's global-rank slots, for repairing changed page extrema.
   * @param rankOffset - First global rank represented by the plan's local tables.
   */
  constructor(
    private plan: SegmentPlan,
    passes: readonly PlannedPass[],
    private readonly changes: SegmentRangeChanges,
    private readonly slotsOfRank: (rank: number, passName: string) => readonly number[],
    private readonly rankOffset = 0,
  ) {
    this.entries = plan.entries.map((entry) => ({ entry, remaining: 0 }));
    passes.forEach((pass, index) => {
      let rangeCount = 0;
      let records = 0;
      for (const entry of plan.entries) {
        if (entry.passName !== pass.name) continue;
        rangeCount += entry.ranges.length;
        for (const range of entry.ranges) records += range.count;
      }
      this.passes.set(pass.name, {
        pass,
        index,
        records:
          rangeCount > 0
            ? {
                // Small or fragmented sets are cheaper in the original slot map. Only long
                // runs pay for the interval index and its binary-search lookups.
                entryOfSlot:
                  records >= 256 && records > 8 * rangeCount ? new SlotEntryRanges() : new Map(),
                countByRank: new Uint32Array(plan.passMaskByRank.length),
              }
            : undefined,
        span: plan.pageSpans.find((span) => span.passIndex === index),
        cursor: undefined,
      });
    });
    this.collectEntries();
    plan.passMaskByRank.forEach((mask, rank) => {
      if (mask === 0) return;
      const segment = plan.segmentOfRank[rank] ?? -1;
      this.ranksBySegment.set(segment, (this.ranksBySegment.get(segment) ?? 0) + 1);
    });
    this.observe();
  }

  /**
   * Slot metadata visits in the last patch, including affected objects' page-extrema scans.
   *
   * @returns The logical slot visits; full-plan initialization is excluded.
   */
  get slotReads(): number {
    return this.reads;
  }

  /**
   * Number of currently owned live records, excluding unowned bridges.
   *
   * @returns Live record count.
   */
  get liveRecords(): number {
    return this.entries.reduce((sum, entry) => sum + entry.remaining, 0);
  }

  /** Advances copied cursors after a frame whose full draw coverage stayed identical. */
  observe(): void {
    for (const state of this.passes.values()) {
      const change = this.changes(state.pass.name);
      state.cursor = change && { source: change.source, revision: change.revision };
    }
  }

  /**
   * Applies consecutive removal-only changes atomically, or leaves the plan untouched.
   *
   * @returns The patched plan, or undefined when a full replan is required.
   */
  patch(): SegmentPlan | undefined {
    this.reads = 0;
    const pending = this.pending();
    if (!pending) return undefined;
    const cuts = new Map<number, InstanceRange[]>();
    for (const { state, ranges, cursor } of pending) {
      this.remove(state, ranges, cuts);
      state.cursor = cursor;
    }
    for (const [index, removed] of cuts) {
      const state = this.entries[index];
      if (state && state.remaining > 0) {
        state.entry = { ...state.entry, ranges: subtractRanges(state.entry.ranges, removed) };
      }
    }
    this.plan = {
      ...this.plan,
      entries: this.entries.filter(({ remaining }) => remaining > 0).map(({ entry }) => entry),
      segmentCount: this.ranksBySegment.size,
    };
    return this.plan;
  }

  private pending(): PendingRemoval[] | undefined {
    const result: PendingRemoval[] = [];
    for (const state of this.passes.values()) {
      const change = this.changes(state.pass.name);
      const old = state.cursor;
      if (!change || old?.source !== change.source) return undefined;
      const cursor = { source: change.source, revision: change.revision };
      if (change.revision === old.revision) continue;
      if (
        change.previousRevision !== old.revision ||
        change.revision !== old.revision + 1 ||
        change.added.length > 0
      )
        return undefined;
      // Copy immediately: another provider call may reuse and mutate the same scratch record.
      const ranges = change.removed
        .map(({ start, count }) => ({ start, count }))
        .sort((a, b) => a.start - b.start);
      result.push({ state, cursor, ranges });
    }
    return result;
  }

  private collectEntries(): void {
    this.entries.forEach((entry, index) => {
      const state = this.passes.get(entry.entry.passName);
      if (!state?.records) return;
      const { entryOfSlot, countByRank } = state.records;
      if (entryOfSlot instanceof Map) {
        for (const { start, count } of entry.entry.ranges) {
          for (let slot = start; slot < start + count; slot++) {
            const rank = (state.pass.owners.rankOfSlot[slot] ?? -1) - this.rankOffset;
            if (rank < 0 || entryOfSlot.has(slot)) continue;
            entryOfSlot.set(slot, index);
            countByRank[rank] = (countByRank[rank] ?? 0) + 1;
            entry.remaining += 1;
          }
        }
        return;
      }
      for (const range of entry.entry.ranges) {
        for (const { start, count } of entryOfSlot.add(range, index)) {
          const end = Math.min(start + count, state.pass.owners.rankOfSlot.length);
          for (let slot = start; slot < end; slot += 1) {
            const rank = (state.pass.owners.rankOfSlot[slot] ?? -1) - this.rankOffset;
            if (rank < 0) continue;
            countByRank[rank] = (countByRank[rank] ?? 0) + 1;
            entry.remaining += 1;
          }
        }
      }
    });
    for (const state of this.passes.values())
      if (state.records?.entryOfSlot instanceof SlotEntryRanges)
        state.records.entryOfSlot.prepare();
  }

  private remove(
    state: PassState,
    ranges: readonly InstanceRange[],
    cuts: Map<number, InstanceRange[]>,
  ): void {
    if (!state.records) return;
    const { entryOfSlot, countByRank } = state.records;
    const ranks = new Set<number>();
    for (const { start, count } of ranges) {
      const end = Math.min(start + count, state.pass.owners.rankOfSlot.length);
      for (let slot = start; slot < end; slot += 1) {
        this.reads += 1;
        const rank = (state.pass.owners.rankOfSlot[slot] ?? -1) - this.rankOffset;
        if (rank < 0) continue;
        const index = entryOfSlot.get(slot) ?? -1;
        const entry = this.entries[index];
        if (!entry) continue;
        entryOfSlot.delete(slot);
        entry.remaining -= 1;
        appendCut(cuts, index, slot);
        countByRank[rank] = (countByRank[rank] ?? 1) - 1;
        if (countByRank[rank] === 0) this.hideRankPass(state.index, rank);
        if (state.span) ranks.add(rank);
      }
    }
    for (const rank of ranks) this.repairPages(state, rank);
  }

  private hideRankPass(passIndex: number, rank: number): void {
    const mask = (this.plan.passMaskByRank[rank] ?? 0) & ~(1 << passIndex);
    this.plan.passMaskByRank[rank] = mask;
    if (mask !== 0) return;
    const segment = this.plan.segmentOfRank[rank] ?? -1;
    const remaining = (this.ranksBySegment.get(segment) ?? 1) - 1;
    if (remaining > 0) this.ranksBySegment.set(segment, remaining);
    else this.ranksBySegment.delete(segment);
  }

  private repairPages(state: PassState, rank: number): void {
    const { span, pass } = state;
    if (!span || !pass.pageOfSlot || !state.records) return;
    const { entryOfSlot, countByRank } = state.records;
    let min = 2 ** 31 - 1;
    let max = -1;
    if (countByRank[rank] !== 0) {
      for (const slot of this.slotsOfRank(rank + this.rankOffset, pass.name)) {
        this.reads += 1;
        if ((entryOfSlot.get(slot) ?? -1) < 0) continue;
        const page = pass.pageOfSlot[slot] ?? 0;
        min = Math.min(min, page);
        max = Math.max(max, page);
      }
    }
    span.minPageByRank[rank] = min;
    span.maxPageByRank[rank] = max;
  }
}

function appendCut(cuts: Map<number, InstanceRange[]>, index: number, slot: number): void {
  let ranges = cuts.get(index);
  if (!ranges) {
    ranges = [];
    cuts.set(index, ranges);
  }
  const last = ranges.at(-1);
  if (last && last.start + last.count === slot) {
    ranges[ranges.length - 1] = { start: last.start, count: last.count + 1 };
  } else ranges.push({ start: slot, count: 1 });
}
