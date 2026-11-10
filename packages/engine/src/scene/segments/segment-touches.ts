import type { ObjectId } from '@canvas/schema';

import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange } from '../scene-culler.js';
import type { Scene } from '../scene.js';

import type { SegmentSpatialIndex } from './segment-moves.js';
import type { PlannedPass } from './segment-plan.js';
import { normalizedRanges } from './segment-window.js';

/** Per pass, slots. */
export type TouchedSlots = ReadonlyMap<string, readonly number[]>;

/** What a patch must plan again since the last plan, besides the culler's changes. */
export interface TouchedRecords {
  /** Drawn slots whose page or drawing box changed: planned again where they are. */
  readonly replanned: TouchedSlots;
  /** Drawn slots of objects it showed since: they enter. */
  readonly shown: TouchedSlots;
  /**
   * Drawn slots of objects it hid since: they leave, and the windows around them are planned
   * again so the segments they kept apart can merge. Absent: none.
   */
  readonly hidden?: TouchedSlots;
}

/** No touched records. */
export const NO_TOUCHED: TouchedRecords = {
  replanned: new Map(),
  shown: new Map(),
  hidden: new Map(),
};

/** Per pass, per paint rank, 1 where the level of detail hides the object; absent: none. */
type HiddenTables = readonly (Uint8Array | undefined)[];

/** A hidden table that hides nothing. */
const NO_HIDDEN = new Uint8Array(0);

/** The source of a pass's merged change when the culler reported none for it. */
const TOUCH_SOURCE = {};

/**
 * What changed since the last z-order plan without a document edit or a coverage change:
 * the slots of the paged passes whose page changed, and the objects whose asynchronous drawing
 * boxes changed (`SceneSpatialIndex.drawingChanges`). Their records stay where they are, but the
 * plan's merges and page splits around them may no longer hold, so a patch plans their intervals
 * again instead of the whole board.
 */
export class SegmentTouches {
  /** Each paged pass's page table at the last plan, by pass name. */
  private readonly pages = new Map<string, Int32Array>();
  /** Each paged pass's page revision at the last plan, by pass name. */
  private readonly pageRevisions = new Map<string, number>();
  private drawingRevision = -1;
  /** The hidden tables the last plan was made with. */
  private hidden: HiddenTables = [];

  /**
   * Starts with nothing planned.
   *
   * @param spatial - The culler's index, for drawing changes; absent, none are tracked.
   */
  constructor(private readonly spatial: SegmentSpatialIndex | undefined) {}

  /**
   * Remembers the tables a plan (full or patched) was made with.
   *
   * @param scene - The scene, for its page tables.
   * @param hidden - The hidden tables it was made with.
   */
  planned(scene: Pick<Scene, 'passes' | 'pagesOf' | 'pageRevisionOf'>, hidden: HiddenTables): void {
    this.hidden = hidden;
    this.drawingRevision = this.spatial?.drawingBoundsRevision ?? 0;
    for (const { name } of scene.passes) {
      const table = scene.pagesOf(name);
      if (table === undefined) continue;
      const revision = scene.pageRevisionOf(name);
      if (this.pageRevisions.get(name) === revision && this.pages.has(name)) continue;
      this.pageRevisions.set(name, revision);
      const copy = this.pages.get(name);
      if (copy?.length === table.length) copy.set(table);
      else this.pages.set(name, table.slice());
    }
  }

  /**
   * Whether a page table or a drawing box changed since the last plan.
   *
   * @param scene - The scene, for its page revisions.
   * @returns True when one did.
   */
  isDirty(scene: Pick<Scene, 'passes' | 'pagesOf' | 'pageRevisionOf'>): boolean {
    if ((this.spatial?.drawingBoundsRevision ?? 0) !== this.drawingRevision) return true;
    return scene.passes.some(
      ({ name }) =>
        scene.pagesOf(name) !== undefined &&
        this.pageRevisions.get(name) !== scene.pageRevisionOf(name),
    );
  }

  /**
   * The slots drawn now whose page or drawing box changed since the last plan.
   *
   * @param scene - The scene, for page tables and each object's slots.
   * @param drawList - The culler's draw list, what is drawn now.
   * @param hidden - The current hidden tables.
   * @param slotsOf - One paint rank's slots in a pass (`slotsOfRank`); absent before a full plan.
   * @returns The touched records, or undefined when the changes are not known one by one or are
   *   more than a patch takes.
   */
  collect(
    scene: Pick<Scene, 'passes' | 'pagesOf' | 'pageRevisionOf' | 'slotsOf'>,
    drawList: readonly DrawListEntry[],
    hidden: HiddenTables,
    slotsOf: ((rank: number, passName: string) => readonly number[]) | undefined,
  ): TouchedRecords | undefined {
    const { spatial } = this;
    const touched = new Map<string, number[]>();
    const budget = { left: touchLimitOf(drawList) };
    // Adds a slot, or answers false once more are touched than a patch would take.
    const add = (name: string, slot: number): boolean => {
      const slots = touched.get(name) ?? [];
      slots.push(slot);
      touched.set(name, slots);
      budget.left -= 1;
      return budget.left >= 0;
    };
    for (const { name } of scene.passes) {
      const table = scene.pagesOf(name);
      const copy = this.pages.get(name);
      if (table === undefined || copy === undefined) continue;
      if (this.pageRevisions.get(name) === scene.pageRevisionOf(name)) continue;
      if (copy.length !== table.length) return undefined;
      for (let slot = 0; slot < table.length; slot += 1)
        if (copy[slot] !== table[slot] && !add(name, slot)) return undefined;
    }
    if ((spatial?.drawingBoundsRevision ?? 0) !== this.drawingRevision) {
      const ids = spatial?.drawingChanges?.since(this.drawingRevision);
      if (ids === undefined) return undefined;
      for (const id of new Set<ObjectId>(ids)) {
        for (const { name } of scene.passes)
          for (const slot of scene.slotsOf(id, name)) if (!add(name, slot)) return undefined;
      }
    }
    if (slotsOf === undefined) return undefined;
    const flips = flipsOf(scene.passes, this.hidden, hidden, slotsOf, budget);
    if (flips === undefined) return undefined;
    return {
      replanned: drawnOnly(touched, drawList),
      shown: drawnOnly(flips.shown, drawList),
      // Every slot of a hidden rank: removing one the plan did not draw does nothing.
      hidden: flips.hidden,
    };
  }
}

/**
 * The slots of the ranks whose hidden flag flipped, by direction.
 *
 * @param passes - The scene's passes, in pass order.
 * @param before - The hidden tables the plan was made with.
 * @param after - The current ones.
 * @param slotsOf - One paint rank's slots in a pass.
 * @param budget - How many more slots a patch takes; spent here.
 * @param budget.left - The slots left.
 * @returns Per pass, the slots hidden since and those shown since, or undefined past the budget.
 */
function flipsOf(
  passes: readonly { readonly name: string }[],
  before: HiddenTables,
  after: HiddenTables,
  slotsOf: (rank: number, passName: string) => readonly number[],
  budget: { left: number },
): { hidden: Map<string, number[]>; shown: Map<string, number[]> } | undefined {
  const hidden = new Map<string, number[]>();
  const shown = new Map<string, number[]>();
  if (before === after) return { hidden, shown };
  for (const [index, { name }] of passes.entries()) {
    const was = before[index];
    const now = after[index];
    if (was === now) continue;
    const length = Math.max(was?.length ?? 0, now?.length ?? 0);
    for (let rank = 0; rank < length; rank += 1) {
      const isHidden = now?.[rank] === 1;
      if ((was?.[rank] === 1) === isHidden) continue;
      const rankSlots = slotsOf(rank, name);
      budget.left -= rankSlots.length;
      if (budget.left < 0) return undefined;
      const flipped = isHidden ? hidden : shown;
      const slots = flipped.get(name) ?? [];
      slots.push(...rankSlots);
      flipped.set(name, slots);
    }
  }
  return { hidden, shown };
}

/** Boards under this many drawn records patch whatever they touch: their work is small anyway. */
const TOUCH_LIMIT_FLOOR = 1024;

/**
 * How many slots a patch takes before a full plan is cheaper: a quarter of the drawn
 * records, as #460's cost guard (`verdictBeforeGraph`) refuses the graph from there.
 *
 * @param drawList - The draw list.
 * @returns The limit; unbounded on a small board.
 */
function touchLimitOf(drawList: readonly DrawListEntry[]): number {
  let drawn = 0;
  for (const { ranges } of drawList) for (const { count } of ranges) drawn += count;
  return drawn < TOUCH_LIMIT_FLOOR ? Infinity : drawn / 4;
}

/**
 * Keeps the slots the draw list draws.
 *
 * @param touched - Per pass, candidate slots.
 * @param drawList - The draw list.
 * @returns Per pass, the drawn ones.
 */
function drawnOnly(
  touched: ReadonlyMap<string, number[]>,
  drawList: readonly DrawListEntry[],
): TouchedSlots {
  const drawn = new Map<string, number[]>();
  for (const [name, slots] of touched) {
    const ranges = normalizedRanges(
      drawList.filter(({ passName }) => passName === name).flatMap(({ ranges }) => ranges),
    );
    const kept = slots.filter((slot) => isInRanges(ranges, slot));
    if (kept.length > 0) drawn.set(name, kept);
  }
  return drawn;
}

/**
 * Whether sorted disjoint ranges hold a slot.
 *
 * @param ranges - The ranges, ascending.
 * @param slot - The slot.
 * @returns True when one holds it.
 */
function isInRanges(ranges: readonly InstanceRange[], slot: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (range === undefined || range.start + range.count <= slot) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return range !== undefined && range.start <= slot;
}

/**
 * The culler's changes with the touched records: a replanned slot as leaving and entering again,
 * so its interval is planned again from current tables, and a shown one entering (the cursors
 * stay the culler's).
 *
 * @param pending - The culler's validated changes, by pass.
 * @param touched - The touched records.
 * @returns The changes to route.
 */
export function withTouched(
  pending: ReadonlyMap<string, CullRangeChange>,
  touched: TouchedRecords,
): ReadonlyMap<string, CullRangeChange> {
  const merged = new Map(pending);
  const merge = (slots: TouchedSlots, kinds: readonly ('added' | 'removed')[]): void => {
    for (const [name, list] of slots) {
      const base = merged.get(name);
      const ranges = list.map((start) => ({ start, count: 1 }));
      merged.set(name, {
        source: base?.source ?? TOUCH_SOURCE,
        revision: base?.revision ?? 0,
        previousRevision: base?.previousRevision ?? -1,
        added: [...(base?.added ?? []), ...(kinds.includes('added') ? ranges : [])],
        removed: [...(base?.removed ?? []), ...(kinds.includes('removed') ? ranges : [])],
      });
    }
  };
  merge(touched.replanned, ['added', 'removed']);
  merge(touched.shown, ['added']);
  if (touched.hidden) merge(touched.hidden, ['removed']);
  return merged;
}

/**
 * The passes with other hidden tables (a patch after the level of detail changed).
 *
 * @param passes - The planned passes.
 * @param hidden - Per pass, its hidden table; absent hides nothing.
 * @returns The passes, each with its table.
 */
export function withHidden(passes: readonly PlannedPass[], hidden: HiddenTables): PlannedPass[] {
  // An empty table hides nothing, as an absent one does.
  return passes.map((pass, index) => ({ ...pass, isHiddenByRank: hidden[index] ?? NO_HIDDEN }));
}
