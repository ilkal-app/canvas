import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import type { SegmentPlan, SegmentPlanInput } from './segment-plan.js';
import { SegmentRemovals } from './segment-removals.js';
import { subtractRanges } from './subtract-ranges.js';

/** One pass's routed changes inside a stable rank interval. */
export interface WindowDelta {
  /** Entering owned GPU slots. */
  readonly added: InstanceRange[];
  /** Departing owned GPU slots. */
  readonly removed: InstanceRange[];
}

interface RemovalState {
  readonly changes: Map<string, CullRangeChange>;
  readonly removals: SegmentRemovals;
}

/**
 * A window's draws and counts, with its local rank tables cut from a larger plan only when first
 * needed: most windows of a patched plan are never touched, so they never pay for them.
 */
export interface WindowCut {
  /** Its draws: global slot ranges. */
  readonly entries: DrawListEntry[];
  /** 1 for a drawn segment, 0 for an interval with none. */
  readonly segmentCount: number;
  /** Whether the plan it was cut from merged splits by boxes. */
  readonly hasSpatialMerges: boolean;
  /**
   * Cuts its local rank tables.
   *
   * @returns The window's local plan.
   */
  readonly build: () => SegmentPlan;
}

/** Local plan metadata for one old segment's complete global paint-rank interval. */
export class SegmentWindow {
  private state: RemovalState | undefined;
  private source: SegmentPlan | WindowCut;
  private initialLiveRecords: number | undefined;

  /**
   * Creates an independently owned interval cache.
   *
   * @param from - Inclusive global paint rank.
   * @param to - Exclusive global paint rank.
   * @param id - Unique live segment identity, unrelated to paint-order position.
   * @param plan - Local rank tables and global GPU draw slots, or a cut that builds them.
   * @param input - Stable full-domain pass/rank information.
   * @param slotsOfRank - Global-rank slot lookup.
   */
  constructor(
    readonly from: number,
    readonly to: number,
    readonly id: number,
    plan: SegmentPlan | WindowCut,
    private readonly input: SegmentPlanInput,
    private readonly slotsOfRank: (rank: number, name: string) => readonly number[],
  ) {
    this.source = plan;
  }

  /**
   * The local plan, its rank tables built on first use.
   *
   * @returns The plan.
   */
  get plan(): SegmentPlan {
    if ('build' in this.source) this.source = this.source.build();
    return this.source;
  }

  /**
   * Its draws, global slot ranges, without building its rank tables.
   *
   * @returns The draws.
   */
  get entries(): readonly DrawListEntry[] {
    return this.source.entries;
  }

  /**
   * Its drawn segments, 0 or 1 (more once a removal splits it).
   *
   * @returns The count.
   */
  get segmentCount(): number {
    return this.source.segmentCount;
  }

  /**
   * Whether its plan merged splits by boxes.
   *
   * @returns True when it did.
   */
  get hasSpatialMerges(): boolean {
    return this.source.hasSpatialMerges;
  }

  /**
   * Number of live owned records, excluding free bridges.
   *
   * @returns Live record count.
   */
  get liveRecords(): number {
    if (this.state) return this.state.removals.liveRecords;
    this.initialLiveRecords ??= ownedRecordCount(this.source, this.input, this.from, this.to);
    return this.initialLiveRecords;
  }

  /**
   * Slot visits from the last removal patch.
   *
   * @returns Logical slot visits.
   */
  get slotReads(): number {
    return this.state?.removals.slotReads ?? 0;
  }

  /**
   * Whether this interval has paid for slot ownership and per-rank removal metadata.
   *
   * @returns True after its first removal patch.
   */
  get hasRemovalState(): boolean {
    return this.state !== undefined;
  }

  /**
   * Removes routed slots without invalidating the window's independent revision cursor.
   *
   * @param deltas - This window's changes; additions are handled by replacing the whole window.
   * @throws {Error} When the private local cursor is inconsistent.
   */
  remove(deltas: ReadonlyMap<string, WindowDelta>): void {
    const { changes, removals } = this.initialize();
    for (const [name, delta] of deltas) {
      const old = changes.get(name);
      if (!old) continue;
      changes.set(name, {
        ...old,
        previousRevision: old.revision,
        revision: old.revision + 1,
        removed: normalizedRanges(delta.removed),
        added: [],
      });
    }
    const next = removals.patch();
    if (!next) throw new Error('Consecutive local window changes must be patchable.');
    this.source = next;
  }

  private initialize(): RemovalState {
    if (this.state) return this.state;
    const changes = new Map<string, CullRangeChange>();
    for (const { name } of this.input.passes)
      changes.set(name, {
        source: {},
        revision: 0,
        previousRevision: -1,
        added: [],
        removed: [],
      });
    const removals = new SegmentRemovals(
      this.plan,
      this.input.passes,
      (name) => changes.get(name),
      this.slotsOfRank,
      this.from,
    );
    this.state = { changes, removals };
    return this.state;
  }
}

/**
 * Builds final visibility for a complete window from its prior live output and routed deltas.
 *
 * @param window - The old interval.
 * @param window.plan - Its previous ordered draw output.
 * @param deltas - Changes to its membership.
 * @returns Global GPU slot ranges, ready for local pure planning.
 */
export function windowVisible(
  window: { readonly plan: Pick<SegmentPlan, 'entries'> },
  deltas: ReadonlyMap<string, WindowDelta>,
): DrawListEntry[] {
  const ranges = new Map<string, InstanceRange[]>();
  for (const entry of window.plan.entries) {
    const list = ranges.get(entry.passName) ?? [];
    list.push(...entry.ranges);
    ranges.set(entry.passName, list);
  }
  for (const [name, delta] of deltas) {
    const kept = subtractRanges(
      normalizedRanges(ranges.get(name) ?? []),
      normalizedRanges(delta.removed),
    );
    ranges.set(name, normalizedRanges([...kept, ...delta.added]));
  }
  return [...ranges].map(([passName, list]) => ({ passName, ranges: normalizedRanges(list) }));
}

/**
 * Sorts and unions overlapping/adjacent global slot ranges without changing the input.
 *
 * @param ranges - Possibly unordered ranges from page/segment draws or routed deltas.
 * @returns Disjoint ascending ranges.
 */
export function normalizedRanges(ranges: readonly InstanceRange[]): InstanceRange[] {
  const result: InstanceRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.count <= 0) continue;
    const last = result.at(-1);
    if (last && last.start + last.count >= range.start) {
      result[result.length - 1] = {
        start: last.start,
        count: Math.max(last.start + last.count, range.start + range.count) - last.start,
      };
    } else result.push({ ...range });
  }
  return result;
}

/**
 * Counts the owned records a plan draws between two paint ranks, once each per pass.
 *
 * @param plan - The plan whose entries are counted.
 * @param input - Its passes' slot owners.
 * @param from - Inclusive global paint rank.
 * @param to - Exclusive global paint rank.
 * @returns Live record count.
 */
export function ownedRecordCount(
  plan: Pick<SegmentPlan, 'entries'>,
  input: SegmentPlanInput,
  from: number,
  to: number,
): number {
  let count = 0;
  for (const pass of input.passes) {
    const ranges = plan.entries
      .filter((entry) => entry.passName === pass.name)
      .flatMap((entry) => entry.ranges);
    for (const range of normalizedRanges(ranges)) {
      const end = Math.min(range.start + range.count, pass.owners.rankOfSlot.length);
      for (let slot = range.start; slot < end; slot += 1) {
        const rank = pass.owners.rankOfSlot[slot] ?? -1;
        if (rank >= from && rank < to) count += 1;
      }
    }
  }
  return count;
}
