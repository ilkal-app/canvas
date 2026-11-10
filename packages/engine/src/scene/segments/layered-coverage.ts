import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import { bucketsOf, type Bucket, type BucketInput } from './layer-buckets.js';
import { CANVAS_WINDOW, keyOf, reownSlots, runKeyOf, type WindowKey } from './layer-reown.js';
import { isSameTables, type LayerStructure } from './layer-structure.js';
import type { PlannedPass } from './segment-plan.js';
import type { SegmentRangeChanges } from './segment-removals.js';
import { patchRanges, SlotChanges } from './slot-ranges.js';
import { tableEntry } from './table-entry.js';

/** A provider cursor: the change revision last taken. */
interface Cursor {
  readonly source: object;
  readonly revision: number;
}

/** One window's slot changes in one pass (and page). */
interface SlotDelta {
  readonly passName: string;
  readonly page: number | undefined;
  readonly slots: SlotChanges;
}

/** What {@link LayeredCoverage.update} reads. */
export interface CoverageInput extends BucketInput {
  /** The culler's coverage changes per pass; omitted, every plan sorts the visible records. */
  readonly rangeChangeOf?: SegmentRangeChanges;
  /** Each rank's slots in a pass; omitted, a change of fallbacks sorts every record afresh. */
  readonly slotsOfRank?: (rank: number, passName: string) => readonly number[];
}

/** The windows' visible records after {@link LayeredCoverage.update}. */
export interface RoutedCoverage {
  /** Each window's visible records, by window key. */
  readonly buckets: ReadonlyMap<WindowKey, Bucket>;
  /**
   * The windows whose records changed since the last update; undefined when they were sorted
   * afresh, so any may have.
   */
  readonly touched: ReadonlySet<WindowKey> | undefined;
}

/**
 * The layered plan's visible records by window, kept from plan to plan. While the
 * windows' tables stand and the culler reports each pass's coverage change revision by
 * revision, only the changed slots are sorted to their windows; when only the fallbacks changed
 * (which layers are planned), the visible slots of the ranks that changed window move too.
 * Otherwise every visible record is sorted afresh (`bucketsOf`). The canvas's share of each
 * update is its own coverage change ({@link LayeredCoverage.canvasChangeOf}), one revision per
 * update, for the canvas's interval cache. The frame's thread.
 */
export class LayeredCoverage {
  private buckets = new Map<WindowKey, Bucket>();
  private readonly cursors = new Map<string, Cursor>();
  private structure: LayerStructure | undefined;
  private revision = 0;
  private canvas = new Map<string, SlotChanges>();
  private readonly published = new Map<string, CullRangeChange>();
  /** The last slot change's window, pass and page, and its changes. */
  private last:
    | {
        readonly deltas: object;
        readonly key: WindowKey;
        readonly pass: PlannedPass;
        readonly page: number | undefined;
        readonly delta: SlotDelta;
      }
    | undefined;

  /**
   * The canvas's share of the last update's changes, per pass: one revision per update.
   *
   * @param passName - The pass.
   * @returns The change.
   */
  readonly canvasChangeOf: SegmentRangeChanges = (passName) => {
    let change = this.published.get(passName);
    if (change === undefined) {
      const slots = this.canvas.get(passName);
      change = {
        source: this,
        revision: this.revision,
        previousRevision: this.revision - 1,
        added: slots?.added() ?? [],
        removed: slots?.removed() ?? [],
      };
      this.published.set(passName, change);
    }
    return change;
  };

  /** Forgets everything: the next update sorts afresh. */
  clear(): void {
    this.structure = undefined;
  }

  /**
   * Adds to the canvas's change this update (the composites the canvas draws).
   *
   * @param passName - The pass.
   * @param added - Slots added.
   * @param removed - Slots removed.
   */
  noteCanvasChange(passName: string, added: readonly number[], removed: readonly number[]): void {
    const slots = this.canvasSlots(passName);
    for (const slot of added) slots.add(slot);
    for (const slot of removed) slots.remove(slot);
    this.published.delete(passName);
  }

  /**
   * The windows' visible records for this plan.
   *
   * @param input - The visible records, passes and coverage changes.
   * @param structure - The windows: which layer holds each rank, which ranks are invisible.
   * @returns The records by window, and which changed.
   * @throws {RangeError} When a visible entry names no pass.
   */
  update(input: CoverageInput, structure: LayerStructure): RoutedCoverage {
    this.revision += 1;
    this.canvas = new Map();
    this.published.clear();
    const deltas = new Map<WindowKey, Map<string, SlotDelta>>();
    const before = this.structure;
    const isRouted =
      before !== undefined &&
      (before === structure ||
        (input.slotsOfRank !== undefined && isSameTables(before.from, structure.from))) &&
      this.route(input, structure, deltas, before);
    this.structure = structure;
    if (!isRouted) {
      const byIndex = bucketsOf(input, structure.ownerOfRank, structure.invisible);
      this.buckets = new Map(
        [...byIndex].map(([index, bucket]) => [keyOf(structure, index), bucket]),
      );
      this.observe(input);
      return { buckets: this.buckets, touched: undefined };
    }
    for (const [key, byPass] of deltas) {
      let bucket = this.buckets.get(key);
      if (bucket === undefined) {
        bucket = new Map();
        this.buckets.set(key, bucket);
      }
      for (const [runKey, { passName, page, slots }] of byPass) {
        // A fresh run, so plans that took the old ranges keep them.
        const ranges = patchRanges(
          bucket.get(runKey)?.ranges ?? [],
          slots.added(),
          slots.removed(),
        );
        if (ranges.length === 0) bucket.delete(runKey);
        else bucket.set(runKey, { passName, page, ranges });
      }
      if (bucket.size === 0) this.buckets.delete(key);
    }
    return { buckets: this.buckets, touched: new Set(deltas.keys()) };
  }

  /**
   * Takes every pass's current revision.
   *
   * @param input - The passes and coverage changes.
   */
  private observe(input: CoverageInput): void {
    this.cursors.clear();
    for (const { name } of input.passes) {
      const change = input.rangeChangeOf?.(name);
      if (change !== undefined) {
        this.cursors.set(name, { source: change.source, revision: change.revision });
      }
    }
  }

  /**
   * Sorts this update's changes to the windows: first the visible slots of ranks whose window
   * changed with the fallbacks, then each pass's next coverage change. Nothing is changed when
   * some pass's change is not the next revision (or there is none).
   *
   * @param input - The passes and coverage changes.
   * @param structure - The windows now.
   * @param deltas - Where the changes go, by window, then pass and page.
   * @param before - The windows at the last update.
   * @returns Whether the changes could be sorted.
   */
  private route(
    input: CoverageInput,
    structure: LayerStructure,
    deltas: Map<WindowKey, Map<string, SlotDelta>>,
    before: LayerStructure,
  ): boolean {
    const changes: [PlannedPass, CullRangeChange | undefined][] = [];
    for (const pass of input.passes) {
      const change = input.rangeChangeOf?.(pass.name);
      const cursor = this.cursors.get(pass.name);
      if (change === undefined || cursor?.source !== change.source) return false;
      const isNext =
        change.previousRevision === cursor.revision && change.revision === cursor.revision + 1;
      if (change.revision !== cursor.revision && !isNext) return false;
      changes.push([pass, change.revision === cursor.revision ? undefined : change]);
    }
    const { slotsOfRank } = input;
    if (before !== structure && slotsOfRank !== undefined) {
      reownSlots(
        { ...input, slotsOfRank },
        before,
        structure,
        this.buckets,
        (from, to, pass, slot) => {
          this.change(deltas, from, pass, slot, false);
          this.change(deltas, to, pass, slot, true);
        },
      );
    }
    for (const [pass, change] of changes) {
      if (change === undefined) continue;
      this.cursors.set(pass.name, { source: change.source, revision: change.revision });
      if (pass.name === input.compositePassName) continue;
      const isOutside = input.outsidePassNames.has(pass.name);
      const { ownerOfRank, invisible } = structure;
      for (const kind of ['added', 'removed'] as const) {
        forOwnedSlots(pass, change[kind], (slot, rank) => {
          if (invisible[rank] === 1) return;
          const key = isOutside ? CANVAS_WINDOW : keyOf(structure, tableEntry(ownerOfRank, rank));
          this.change(deltas, key, pass, slot, kind === 'added');
        });
      }
    }
    return true;
  }

  /**
   * Notes one slot added to or removed from a window, and from the canvas's change.
   *
   * @param deltas - The changes by window.
   * @param key - The window.
   * @param pass - The pass.
   * @param slot - The slot.
   * @param isAdded - Whether it was added.
   */
  private change(
    deltas: Map<WindowKey, Map<string, SlotDelta>>,
    key: WindowKey,
    pass: PlannedPass,
    slot: number,
    isAdded: boolean,
  ): void {
    const page = pass.pageOfSlot === undefined ? undefined : (pass.pageOfSlot[slot] ?? 0);
    const last = this.last;
    // Consecutive slots mostly go to one window, pass and page.
    const delta =
      last?.deltas === deltas && last.key === key && last.pass === pass && last.page === page
        ? last.delta
        : deltaOf(deltas, key, pass, slot);
    this.last = { deltas, key, pass, page, delta };
    const { slots } = delta;
    if (isAdded) slots.add(slot);
    else slots.remove(slot);
    if (key !== CANVAS_WINDOW) return;
    const canvas = this.canvasSlots(pass.name);
    if (isAdded) canvas.add(slot);
    else canvas.remove(slot);
  }

  /**
   * The canvas's slot changes in a pass this update, made on first use.
   *
   * @param passName - The pass.
   * @returns The changes.
   */
  private canvasSlots(passName: string): SlotChanges {
    let slots = this.canvas.get(passName);
    if (slots === undefined) {
      slots = new SlotChanges();
      this.canvas.set(passName, slots);
    }
    return slots;
  }
}

/**
 * Calls back for each owned slot of some ranges.
 *
 * @param pass - The pass.
 * @param ranges - The ranges.
 * @param visit - Called with each owned slot and its rank.
 */
function forOwnedSlots(
  pass: PlannedPass,
  ranges: readonly InstanceRange[],
  visit: (slot: number, rank: number) => void,
): void {
  const { rankOfSlot } = pass.owners;
  for (const { start, count } of ranges) {
    const end = Math.min(start + count, rankOfSlot.length);
    for (let slot = start; slot < end; slot += 1) {
      const rank = tableEntry(rankOfSlot, slot);
      if (rank >= 0) visit(slot, rank);
    }
  }
}

/**
 * A window's slot changes in a slot's pass and page, made on first use.
 *
 * @param deltas - The changes by window, then pass and page.
 * @param key - The window.
 * @param pass - The pass.
 * @param slot - The slot, for its page.
 * @returns The changes.
 */
function deltaOf(
  deltas: Map<WindowKey, Map<string, SlotDelta>>,
  key: WindowKey,
  pass: PlannedPass,
  slot: number,
): SlotDelta {
  let byRun = deltas.get(key);
  if (byRun === undefined) {
    byRun = new Map();
    deltas.set(key, byRun);
  }
  const run = runKeyOf(pass, slot);
  let delta = byRun.get(run.key);
  if (delta === undefined) {
    delta = { passName: pass.name, page: run.page, slots: new SlotChanges() };
    byRun.set(run.key, delta);
  }
  return delta;
}
