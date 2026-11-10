import type { BoardObject, ObjectId } from '@canvas/schema';

import { LodChangeBudget, type LevelOfDetailOptions } from './lod-budget.js';
import { forEachCrossing } from './lod-crossings.js';
import {
  LodPassState,
  type LodBand,
  type LodCounters,
  type LodEntry,
  type LodObject,
  type PassLevelOfDetail,
} from './lod-pass-state.js';
import type { LodForm } from './lod-rule.js';
import { LodVisibility, type LodVisibilityInput } from './lod-visibility.js';

export type { LodBand, LodCounters, PassLevelOfDetail } from './lod-pass-state.js';
export type { LevelOfDetailOptions } from './lod-budget.js';

/** A pass as the level of detail sees it: its name and, if it has one, its rule. */
export interface LodPass {
  /** The pass's name. */
  readonly name: string;
  /** Its rule and the size it measures; absent, it draws everything in full. */
  readonly levelOfDetail?: PassLevelOfDetail;
}

/** How often an object's form changed, in all and across each threshold of its rule. */
export interface LodHistory {
  /** Changes of form since it was first evaluated. */
  readonly transitions: number;
  /** Per threshold, in the rule's order: changes across it and traversals of its 20% band. */
  readonly bands: readonly Readonly<LodBand>[];
}

const NO_IDS: ReadonlySet<ObjectId> = new Set();

/**
 * The scene's level-of-detail state: per object and pass with a rule
 * (`PassLevelOfDetail`), the form it draws in (`full`, greek bars, average colour, chords, hidden),
 * remembered so each threshold has a hysteresis band per object (`lodLevelOf`). `update` runs once
 * per frame, before the passes rewrite records: it evaluates the objects the culler found visible,
 * and only them: entering IDs when the visible set changed (an object entering it takes the form
 * for the current scale), else, on a zoom, only the objects whose size on screen the zoom took
 * across an edge of their rule (`lodEdgesOf`), found by binary search in each pass's sorted sizes,
 * so a zoom frame costs O(log sizes) plus the objects that cross, whatever the spread of sizes, and
 * a pan O(1). Passes read `formOf` when they write records, `changedIn` for what to rewrite, and
 * the z-order segments `hiddenIn` for records to leave out. The frame's thread; `Scene` owns one
 * and keeps it in step with the objects each pass draws.
 */
export class LevelOfDetail {
  private states: (LodPassState | undefined)[] = [];
  private readonly byName = new Map<string, LodPassState>();
  private readonly objects = new Map<ObjectId, LodObject>();
  /** Entries whose size changed or that arrived since the last update. */
  private readonly pending = new Set<LodEntry>();
  private readonly visibility = new LodVisibility();
  /** The objects that entered the visible set at its last change, reused. */
  private readonly entered: ObjectId[] = [];
  /** A zoom's crossed ranges of sorted sizes, start and end pairs, reused. */
  private readonly runs: number[] = [];
  private hasUpdated = false;
  private visible = 0;
  private hidden = 0;
  private updates = 0;
  private lastScale = Number.NaN;
  private evaluated = 0;
  private scanned = 0;
  private readonly budget: LodChangeBudget;

  /**
   * Creates the state with no passes.
   *
   * @param options - The per-update cap on form changes.
   * @throws {RangeError} When `changesPerFrame` is neither an integer of at least 1 nor Infinity.
   */
  constructor(options: LevelOfDetailOptions = {}) {
    this.budget = new LodChangeBudget(options.changesPerFrame);
  }

  /**
   * Takes the passes' rules, in the scene's pass order; call once, before tracking objects.
   *
   * @param passes - The scene's passes.
   */
  register(passes: readonly LodPass[]): void {
    this.states = passes.map(({ name, levelOfDetail }) =>
      levelOfDetail === undefined ? undefined : new LodPassState(name, levelOfDetail),
    );
    this.byName.clear();
    for (const state of this.states) if (state) this.byName.set(state.name, state);
  }

  /**
   * How many times an object's form was worked out, since this was created: for tests of the
   * zoom's cost.
   *
   * @returns The count.
   */
  get evaluations(): number {
    return this.evaluated;
  }

  /**
   * How many entries a zoom's crossing search looked at, since this was created: for tests of
   * the zoom's cost when few objects are visible.
   *
   * @returns The count.
   */
  get crossingScans(): number {
    return this.scanned;
  }

  /**
   * A revision that changes whenever an object becomes hidden or shown in any pass, so the
   * z-order segments re-plan only then.
   *
   * @returns The revision.
   */
  get hiddenRevision(): number {
    return this.hidden;
  }

  /**
   * Counts updates so consumers can detect skipped per-frame changed-ID sets.
   *
   * @returns The update count.
   */
  get updateRevision(): number {
    return this.updates;
  }

  /**
   * A revision that goes up by one whenever the visible set changes.
   *
   * @returns The revision.
   */
  get visibleRevision(): number {
    return this.visible;
  }

  /**
   * The last update's visible set.
   *
   * @returns The culler's ids, or `undefined` when every object is visible.
   */
  get visibleIds(): readonly ObjectId[] | undefined {
    return this.visibility.toArray();
  }

  /**
   * Counts visible objects without materializing their IDs.
   *
   * @returns The count, or undefined when every object is visible.
   */
  get visibleCount(): number | undefined {
    return this.visibility.size;
  }

  /**
   * The tracked objects that entered the visible set at its last change (`visibleRevision`):
   * those not in the set before it. Empty when every object is visible. Reused by the next
   * change.
   *
   * @returns Their ids.
   */
  get enteredIds(): readonly ObjectId[] {
    return this.entered;
  }

  /**
   * Notes that a pass draws an object (created, or changed): its size is measured again and, if
   * it changed, its form is worked out at the next update. The scene calls it for every pass
   * that draws the object.
   *
   * @param passIndex - The pass's index in the scene's order.
   * @param object - The object.
   */
  track(passIndex: number, object: BoardObject): void {
    const state = this.states[passIndex];
    if (state === undefined) return;
    const existing = state.entries.get(object.id);
    if (existing !== undefined) {
      // A move or a recolour changes no size: nothing to measure (fix round 1).
      const isSameSize = state.lod.isSameSize?.(existing.object, object) === true;
      existing.object = object;
      if (isSameSize) return;
      const size = sizeOf(state, object);
      if (existing.size === size) return;
      state.resize(existing, size);
      this.pending.add(existing);
      return;
    }
    let owner = this.objects.get(object.id);
    if (owner === undefined) {
      owner = { id: object.id, entries: [] };
      this.objects.set(object.id, owner);
    }
    const entry: LodEntry = {
      id: object.id,
      object,
      owner,
      pass: state,
      size: Number.NaN,
      level: 0,
      lastPx: Number.NaN,
      transitions: 0,
      bands: state.newBands(),
    };
    owner.entries.push(entry);
    state.entries.set(object.id, entry);
    state.resize(entry, sizeOf(state, object));
    this.pending.add(entry);
  }

  /**
   * Notes that a pass no longer draws an object.
   *
   * @param passIndex - The pass's index in the scene's order.
   * @param id - The object.
   */
  forget(passIndex: number, id: ObjectId): void {
    const state = this.states[passIndex];
    const entry = state?.entries.get(id);
    if (state === undefined || entry === undefined) return;
    if (state.remove(entry)) this.hidden += 1;
    this.pending.delete(entry);
    this.budget.forget(entry);
    const { entries } = entry.owner;
    entries.splice(entries.indexOf(entry), 1);
    if (entries.length === 0) this.objects.delete(id);
  }

  /**
   * Brings every visible object's form up to date for a frame, and counts the changes: the
   * objects that entered the visible set, and, on a zoom, the sizes it took across a band edge.
   *
   * @param visibleIds - The culler's change record or retained legacy array; undefined draws all.
   * @param scale - The camera's scale, device pixels per world unit.
   * @param counters - This frame's counts, added to.
   */
  update(visibleIds: LodVisibilityInput, scale: number, counters: LodCounters): void {
    this.updates += 1;
    for (const state of this.byName.values()) state.changed.clear();
    const isNewSet = this.visibility.update(visibleIds);
    // Changes the cap deferred last update go first; ones no longer visible wait until they enter.
    for (const entry of this.budget.begin())
      if (this.isSeen(entry.owner)) this.evaluate(entry, scale, counters);
    if (isNewSet) {
      this.visible += 1;
      this.evaluateVisible(this.visibility.entered, scale, counters);
    }
    // Objects that stayed visible were evaluated at the last scale: only a crossing matters.
    if (this.hasUpdated && scale !== this.lastScale) this.evaluateCrossedSizes(scale, counters);
    this.hasUpdated = true;
    for (const entry of this.pending) {
      if (this.isSeen(entry.owner)) this.evaluate(entry, scale, counters);
    }
    this.pending.clear();
    this.lastScale = scale;
  }

  /**
   * Whether the cap deferred some form changes to the next update.
   *
   * @returns True while changes wait.
   */
  hasPendingChanges(): boolean {
    return this.budget.hasPending;
  }

  /**
   * The form an object draws in, in a pass.
   *
   * @param passName - The pass.
   * @param id - The object.
   * @returns Its form; `full` for a pass without a rule or an object it does not track.
   */
  formOf(passName: string, id: ObjectId): LodForm {
    const state = this.byName.get(passName);
    const entry = state?.entries.get(id);
    return state === undefined || entry === undefined ? 'full' : state.formAt(entry.level);
  }

  /**
   * The objects whose form in a pass changed in the last update (a first form other than `full`
   * included): what the pass rewrites.
   *
   * @param passName - The pass.
   * @returns Their ids; empty for a pass without a rule.
   */
  changedIn(passName: string): ReadonlySet<ObjectId> {
    return this.byName.get(passName)?.changed ?? NO_IDS;
  }

  /**
   * The objects a pass leaves out (form `hidden`).
   *
   * @param passName - The pass.
   * @returns Their ids; empty for a pass without a rule.
   */
  hiddenIn(passName: string): ReadonlySet<ObjectId> {
    return this.byName.get(passName)?.hidden ?? NO_IDS;
  }

  /**
   * Whether an object was in the last update's visible set.
   *
   * @param id - The object.
   * @returns True when visible, or when every object is.
   */
  isVisible(id: ObjectId): boolean {
    if (this.visibility.size === undefined) return true;
    const owner = this.objects.get(id);
    return owner !== undefined && this.isSeen(owner);
  }

  /**
   * How often an object's form changed in a pass, and, per threshold, how often across it and
   * how often its size traversed the threshold's band.
   *
   * @param passName - The pass.
   * @param id - The object.
   * @returns The counts (copies); zero and no bands for an object the pass does not track.
   */
  historyOf(passName: string, id: ObjectId): LodHistory {
    const entry = this.byName.get(passName)?.entries.get(id);
    return {
      transitions: entry?.transitions ?? 0,
      bands: entry?.bands.map((band) => ({ ...band })) ?? [],
    };
  }

  private isSeen(owner: LodObject): boolean {
    return this.visibility.has(owner.id);
  }

  private evaluateVisible(
    visibleIds: readonly ObjectId[] | undefined,
    scale: number,
    counters: LodCounters,
  ): void {
    this.entered.length = 0;
    if (visibleIds === undefined) {
      for (const state of this.byName.values()) {
        for (const entry of state.entries.values()) this.evaluate(entry, scale, counters);
      }
      return;
    }
    for (const id of visibleIds) {
      const owner = this.objects.get(id);
      if (owner === undefined) continue;
      this.entered.push(id);
      for (const entry of owner.entries) this.evaluate(entry, scale, counters);
    }
  }

  /**
   * On a zoom, evaluates the visible objects whose size on screen crossed an edge of their rule
   * (`forEachCrossing`): the crossed sizes found by binary search, or, when they hold more
   * entries than there are visible objects, the visible objects tested against the edges.
   * Only they can change form.
   *
   * @param scale - The new scale.
   * @param counters - This frame's counts.
   */
  private evaluateCrossedSizes(scale: number, counters: LodCounters): void {
    const zoom = { low: Math.min(scale, this.lastScale), high: Math.max(scale, this.lastScale) };
    const visible = this.visibility.members;
    for (const state of this.byName.values()) {
      this.scanned += forEachCrossing(state, zoom, visible, this.runs, (entry) => {
        if (this.isSeen(entry.owner)) this.evaluate(entry, scale, counters);
      });
    }
  }

  private evaluate(entry: LodEntry, scale: number, counters: LodCounters): void {
    // Entering, crossed-size and pending sets can contain the same entry. A settled
    // form and its band history are unchanged when evaluated again at the same size.
    if (entry.lastPx === entry.size * scale) return;
    this.evaluated += 1;
    const outcome = entry.pass.evaluate(entry, scale, counters, this.budget);
    if (outcome === 'deferred') this.budget.defer(entry);
    else if (outcome === 'flipped') this.hidden += 1;
  }
}

/**
 * An object's size for a pass's rule, one the size index can sort.
 *
 * @param state - The pass.
 * @param object - The object.
 * @returns Its size, world units; 0 (drawn in full) when there is nothing to measure.
 */
function sizeOf(state: LodPassState, object: BoardObject): number {
  const size = state.lod.sizeOf(object);
  return Number.isFinite(size) ? size : 0;
}
