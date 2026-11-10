import type { CullRangeChange } from '../scene-culler.js';

import { eligibleChanges, verdictBeforeGraph } from './segment-patch-guard.js';
import { planSegmentDraws, type SegmentPlan, type SegmentPlanInput } from './segment-plan.js';
import type { SegmentRangeChanges } from './segment-removals.js';
import { NO_TOUCHED, withHidden, withTouched, type TouchedRecords } from './segment-touches.js';
import { buildWindows, copyWindowMetadata } from './segment-window-build.js';
import { windowGroups, type WindowGroup } from './segment-window-groups.js';
import { mergingWindows, routeChanges, type RoutedChanges } from './segment-window-routing.js';
import { ownedRecordCount, windowVisible, type SegmentWindow } from './segment-window.js';

/** Work performed by a stable interval cache, excluding its initial full plan. */
export interface SegmentWindowCounts {
  /** Lazy interval graphs built after a validated coverage delta (at most one per cache). */
  readonly graphBuilds: number;
  /**
   * Interval windows whose local tables were cut, on first use, local replacements
   * included: windows a patch never reaches are never built.
   */
  readonly windowsBuilt: number;
  /** Local removal states initialized for affected windows only. */
  readonly removalBuilds: number;
  /** Complete old intervals repaired for additions. */
  readonly repairs: number;
  /** Live records supplied to successful local pure plans. */
  readonly plannedRecords: number;
  /** Logical ownership reads while routing changes or repairing removal extrema. */
  readonly slotReads: number;
  /** Full-plan refusals caused by a broad affected interval. */
  readonly wideFallbacks: number;
  /** Full-plan refusals caused by actual draw-range growth. */
  readonly compactions: number;
  /** Full-plan refusals made because a patch would cost more than the plan. */
  readonly costFallbacks: number;
}

/** How a {@link SegmentWindows} cache weighs a patch against a full plan. */
export interface SegmentWindowOptions {
  /**
   * Live records below which every patch is tried, however much of the board it changes: a small
   * board's interval graph costs nothing worth guarding. 1024 by default.
   */
  readonly minGuardedRecords?: number;
}

/** The default {@link SegmentWindowOptions.minGuardedRecords}. */
const MIN_GUARDED_RECORDS = 1024;

interface Cursor {
  readonly source: object;
  readonly revision: number;
}

/**
 * Keeps old segment intervals and repairs complete intervals for entering records. Outer
 * boundaries remain conservative; broad changes and fragmentation request a full plan.
 * After any refused patch the caller must discard this cache and construct a full plan.
 */
export class SegmentWindows {
  private windows: SegmentWindow[] | undefined;
  private graphBuilds = 0;
  private windowsBuilt = 0;
  private removalBuilds = 0;
  private readonly cursors = new Map<string, Cursor>();
  private readonly freeIds: number[] = [];
  private nextId = 0;
  private readonly fullDraws: number;
  private repairs = 0;
  private plannedRecords = 0;
  private slotReads = 0;
  private wideFallbacks = 0;
  private compactions = 0;
  private costFallbacks = 0;
  /** Live records over every window (`liveRecords`), counted on first use. */
  private live: number | undefined;
  private readonly minGuardedRecords: number;

  /**
   * Takes ownership of a full plan; interval metadata waits for a validated coverage delta.
   *
   * @param plan - Full-domain plan, privately owned by the stage.
   * @param input - Stable pass ownership, pages, rules and global bounds.
   * @param changes - Borrowed culler deltas, copied before another provider call.
   * @param slotsOfRank - Global-rank slots used to repair affected page extrema.
   * @param options - When a patch is refused for costing more than a full plan.
   */
  constructor(
    private plan: SegmentPlan,
    private input: SegmentPlanInput,
    private readonly changes: SegmentRangeChanges,
    private readonly slotsOfRank: (rank: number, name: string) => readonly number[],
    options: SegmentWindowOptions = {},
  ) {
    this.minGuardedRecords = options.minGuardedRecords ?? MIN_GUARDED_RECORDS;
    this.fullDraws = drawCount(plan);
    this.observe();
  }

  /**
   * Current diagnostic counters; no reference to mutable internal state is exposed.
   *
   * @returns A copied counter snapshot.
   */
  get counts(): SegmentWindowCounts {
    return {
      graphBuilds: this.graphBuilds,
      windowsBuilt: this.windowsBuilt,
      removalBuilds: this.removalBuilds,
      repairs: this.repairs,
      plannedRecords: this.plannedRecords,
      slotReads: this.slotReads,
      wideFallbacks: this.wideFallbacks,
      compactions: this.compactions,
      costFallbacks: this.costFallbacks,
    };
  }

  /** Copies current provider cursors after unchanged full draw coverage. */
  observe(): void {
    for (const { name } of this.input.passes) {
      const change = this.changes(name);
      if (change) this.cursors.set(name, { source: change.source, revision: change.revision });
      else this.cursors.delete(name);
    }
  }

  /**
   * Applies the next precise delta, or requests full planning. Emission still costs all entries.
   * Touched records are planned again as if they left and entered, on `hidden` when the
   * hidden tables changed.
   *
   * @param touched - Records whose page, drawing box or hidden flag changed.
   * @param hidden - Per pass, the current hidden tables, when they changed.
   * @returns Current ordered output, or undefined; a refusal invalidates this cache.
   */
  patch(
    touched: TouchedRecords = NO_TOUCHED,
    hidden?: readonly (Uint8Array | undefined)[],
  ): SegmentPlan | undefined {
    if (hidden) this.input = { ...this.input, passes: withHidden(this.input.passes, hidden) };
    const validated = this.pending();
    if (!validated) return undefined;
    const pending = withTouched(validated, touched);
    if (![...pending.values()].some((change) => change.added.length || change.removed.length)) {
      this.observe();
      return this.plan;
    }
    const hasWindows = this.windows !== undefined;
    if (!hasWindows && this.refusesBeforeGraph(pending)) return undefined;
    const windows = this.initialize();
    const { passes } = this.input;
    const routed = routeChanges(pending, windows, passes, () => (this.slotReads += 1));
    const merging = mergingWindows(touched.hidden ?? new Map(), windows, passes, routed);
    const groups = windowGroups(windows, routed);
    const isRepaired = (group: WindowGroup): boolean =>
      group.windows.some((window) => merging.has(window)) ||
      [...group.deltas.values()].some((delta) => delta.added.length);
    const repaired = groups.filter(isRepaired);
    const live = this.liveRecords;
    const affected = repaired.reduce(
      (sum, { windows, deltas }) =>
        sum +
        windows.reduce((records, window) => records + window.liveRecords, 0) +
        [...deltas.values()].reduce(
          (added, delta) => added + delta.added.reduce((sum, range) => sum + range.count, 0),
          0,
        ),
      0,
    );
    if (repaired.length && (live === 0 || affected >= live / 2)) {
      this.wideFallbacks += 1;
      return undefined;
    }
    const stateCost =
      hasWindows && live >= this.minGuardedRecords ? removalStatesCost(groups, isRepaired) : 0;
    if (stateCost > 0 && stateCost >= live / 2) {
      this.costFallbacks += 1;
      return undefined;
    }
    this.windows = this.applyGroups(windows, groups, routed, isRepaired);
    this.plan = {
      ...this.plan,
      entries: this.windows.flatMap((window) => window.entries),
      segmentCount: this.windows.reduce((sum, window) => sum + window.segmentCount, 0),
      hasSpatialMerges: this.windows.some((window) => window.hasSpatialMerges),
    };
    if (drawCount(this.plan) > Math.max(2 * this.fullDraws, this.fullDraws + 128)) {
      this.compactions += 1;
      return undefined;
    }
    for (const [name, change] of validated)
      this.cursors.set(name, {
        source: change.source,
        revision: change.revision,
      });
    return this.plan;
  }

  /**
   * Repairs the groups that gain records or merge around hidden ones, and removes from the
   * others, keeping the live total (`liveRecords`) current.
   *
   * @param windows - Every window, in rank order.
   * @param groups - The affected groups.
   * @param routed - Each window's share of the delta.
   * @param isRepaired - Whether a group is planned again.
   * @returns The windows after the patch.
   */
  private applyGroups(
    windows: readonly SegmentWindow[],
    groups: readonly WindowGroup[],
    routed: RoutedChanges,
    isRepaired: (group: WindowGroup) => boolean,
  ): SegmentWindow[] {
    const replacements = new Map<SegmentWindow, SegmentWindow[]>();
    let live = this.liveRecords;
    for (const group of groups) {
      if (isRepaired(group)) {
        const first = group.windows[0];
        if (!first) continue;
        for (const window of group.windows) live -= window.liveRecords;
        const next = this.repair(group);
        for (const window of next) live += window.liveRecords;
        for (const window of group.windows) replacements.set(window, []);
        replacements.set(first, next);
      } else {
        for (const window of group.windows) {
          const wasRemovalStateInitialized = window.hasRemovalState;
          live -= window.liveRecords;
          window.remove(routed.get(window) ?? new Map());
          live += window.liveRecords;
          if (!wasRemovalStateInitialized) this.removalBuilds += 1;
          this.slotReads += window.slotReads;
          copyWindowMetadata(this.plan, window);
        }
      }
    }
    this.live = live;
    return windows.flatMap((window) => replacements.get(window) ?? [window]);
  }

  /**
   * The live records the windows hold, counted once per full plan and kept since.
   *
   * @returns The count.
   */
  private get liveRecords(): number {
    this.live ??= ownedRecordCount(this.plan, this.input, 0, this.plan.passMaskByRank.length);
    return this.live;
  }

  /**
   * Decides, before the whole-board interval graph is built, whether the delta is worth it.
   *
   * @param pending - The validated delta.
   * @returns True when the patch is refused (and counted) for a full plan.
   */
  private refusesBeforeGraph(pending: ReadonlyMap<string, CullRangeChange>): boolean {
    const live = this.liveRecords;
    if (live < this.minGuardedRecords) return false;
    const changes = eligibleChanges(this.input.passes, pending);
    const verdict = verdictBeforeGraph(changes, live);
    if (verdict === 'wide') this.wideFallbacks += 1;
    else if (verdict === 'cost') this.costFallbacks += 1;
    return verdict !== 'patch';
  }

  private initialize(): SegmentWindow[] {
    if (this.windows) return this.windows;
    const plan = this.plan;
    // Keep empty paged-pass tables too: an entering record can make that pass visible.
    this.plan = {
      ...this.plan,
      pageSpans: this.input.passes.flatMap((pass, passIndex) => {
        if (!pass.pageOfSlot) return [];
        const old = this.plan.pageSpans.find((span) => span.passIndex === passIndex);
        return [
          old ?? {
            passIndex,
            isPaintOrdered: pass.isPaintOrderedAcrossPages === true,
            minPageByRank: new Int32Array(this.plan.passMaskByRank.length).fill(2 ** 31 - 1),
            maxPageByRank: new Int32Array(this.plan.passMaskByRank.length).fill(-1),
          },
        ];
      }),
    };
    this.windows = buildWindows(
      plan,
      this.input,
      0,
      this.plan.passMaskByRank.length,
      () => this.allocateId(),
      this.slotsOfRank,
      () => (this.windowsBuilt += 1),
    );
    // The windows were cut from this plan: only their ids are new.
    for (const window of this.windows)
      this.plan.segmentOfRank.fill(window.id, window.from, window.to);
    this.graphBuilds += 1;
    return this.windows;
  }

  private repair({ windows, deltas }: WindowGroup): SegmentWindow[] {
    const from = windows[0]?.from ?? 0;
    const to = windows.at(-1)?.to ?? from;
    const old = { plan: { entries: windows.flatMap((window) => window.entries) } };
    const local = planSegmentDraws({
      ...this.input,
      rankOffset: from,
      rankCount: to - from,
      visible: windowVisible(old, deltas),
    });
    for (const window of windows) this.freeIds.push(window.id);
    const next = buildWindows(
      local,
      this.input,
      from,
      to,
      () => this.allocateId(),
      this.slotsOfRank,
      () => (this.windowsBuilt += 1),
    );
    for (const replacement of next) copyWindowMetadata(this.plan, replacement);
    this.repairs += windows.length;
    this.plannedRecords += next.reduce((sum, replacement) => sum + replacement.liveRecords, 0);
    return next;
  }

  private allocateId(): number {
    return this.freeIds.pop() ?? this.nextId++;
  }

  private pending(): Map<string, CullRangeChange> | undefined {
    const result = new Map<string, CullRangeChange>();
    for (const { name } of this.input.passes) {
      const change = this.changes(name);
      const old = this.cursors.get(name);
      // A pass with no change on either side has the coverage it was planned with.
      if (!change && !old) continue;
      if (!change || old?.source !== change.source) return undefined;
      if (change.revision === old.revision) continue;
      if (change.previousRevision !== old.revision || change.revision !== old.revision + 1)
        return undefined;
      result.set(name, {
        ...change,
        added: change.added.map((range) => ({ ...range })),
        removed: change.removed.map((range) => ({ ...range })),
      });
    }
    return result;
  }
}

/**
 * Live records in removal-only windows that would build their removal state in this patch.
 *
 * @param groups - The patch's affected groups.
 * @param isRepaired - Whether a group is planned again instead.
 * @returns Their record count.
 */
function removalStatesCost(
  groups: readonly WindowGroup[],
  isRepaired: (group: WindowGroup) => boolean,
): number {
  let records = 0;
  for (const group of groups) {
    if (isRepaired(group)) continue;
    for (const window of group.windows) if (!window.hasRemovalState) records += window.liveRecords;
  }
  return records;
}

function drawCount(plan: SegmentPlan): number {
  return plan.entries.reduce((sum, entry) => sum + entry.ranges.length, 0);
}
