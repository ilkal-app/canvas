import type { BoardObject, ObjectId } from '@canvas/schema';

import { bandSideOf, lodEdgesOf, lodFormAt, lodLevelOf } from './lod-form.js';
import type { LodForm, LodRule } from './lod-rule.js';
import { LodSizeIndex } from './lod-size-index.js';

/**
 * A pass's level-of-detail rule: the rule, and the size it measures on each object in
 * world units (text: its tallest line; an image: its longer edge; a path: its box's longer side),
 * which the camera's scale turns into device pixels. A pass declares it
 * (`ScenePass.levelOfDetail`); a new kind of object a pass draws adopts the rule by giving it a
 * size, and a new pass by declaring a rule.
 */
export interface PassLevelOfDetail {
  /** The rule. */
  readonly rule: LodRule;
  /**
   * The object's size for the rule, world units; 0 or less (nothing to measure) keeps it in full.
   * Must be a pure function of the object.
   *
   * @param object - An object the pass draws.
   * @returns Its size.
   */
  sizeOf(object: BoardObject): number;
  /**
   * Whether two versions of an object measure the same, told without measuring: true only when
   * no field the size depends on changed (a move, a turn, a recolour), so the scene tracks a
   * dragged object again without measuring it (fix round 1). Must be cheaper than `sizeOf` and
   * never true when the sizes differ; absent, every change of the object measures it again.
   *
   * Takes the version last tracked and the new one; returns true when the size is sure to be
   * the same.
   */
  readonly isSameSize?: (previous: BoardObject, next: BoardObject) => boolean;
}

/** Where each frame's level-of-detail counts go (`FrameStats` has both fields). */
export interface LodCounters {
  /** Objects whose form changed. */
  lodTransitions: number;
  /**
   * Of them, objects that have now changed form across a threshold more often than their size
   * on screen traversed its whole 20% band, plus one (`LodBand`).
   */
  lodThrashes: number;
}

/** A frame's remaining allowance of form changes; `Infinity` for no cap. */
export interface LodBudget {
  /** Form changes the frame may still make; a first form costs none. */
  remaining: number;
}

/** What evaluating an entry did: no hidden flip, a hidden flip, or deferred for the budget. */
export type LodOutcome = 'kept' | 'flipped' | 'deferred';

/**
 * One threshold of an entry's rule, for the no-thrash rule of: how often the object's
 * form changed across it and how often its size on screen traversed the threshold's whole 20%
 * band (from under the threshold to at or above it × 1.2, or back: `bandSideOf`). A rule with
 * its band keeps changes ≤ traversals + 1 (the one: an object first seen inside the band); a
 * rule without memory changes form on every crossing of the threshold itself and so exceeds it
 * as soon as a pinch wobbles across it.
 */
export interface LodBand {
  /** The side of the band the size was last seen on: -1 under, 1 above, 0 not yet known. */
  side: -1 | 0 | 1;
  /** Changes of form across the threshold. */
  transitions: number;
  /** Traversals of the whole band. */
  traversals: number;
}

/** One object's visibility, shared by its entries in every pass with a rule. */
export interface LodObject {
  /** The object ID for membership checks. */
  readonly id: ObjectId;
  /** Its entries, one per pass with a rule that draws it. */
  readonly entries: LodEntry[];
}

/** One object in one pass with a rule. */
export interface LodEntry {
  /** The object. */
  readonly id: ObjectId;
  /** Its version last tracked, of size `size` (`PassLevelOfDetail.isSameSize`). */
  object: BoardObject;
  /** Its visibility. */
  readonly owner: LodObject;
  /** The pass's state. */
  readonly pass: LodPassState;
  /** Its size for the rule, world units. */
  size: number;
  /** Its level (`lodLevelOf`): 0 is full. */
  level: number;
  /** Its size on screen when last evaluated, device px; NaN before the first evaluation. */
  lastPx: number;
  /** How often its form changed. */
  transitions: number;
  /** Per threshold of the rule, in its order: changes across it and traversals of its band. */
  readonly bands: LodBand[];
}

/**
 * The level-of-detail state of one pass with a rule: every object it draws, bucketed by size so
 * a zoom finds the sizes whose forms may change (`lodEdgesOf`), this frame's changed objects and
 * the hidden ones. CPU-only; the frame's thread.
 */
export class LodPassState {
  /** The pass's objects. */
  readonly entries = new Map<ObjectId, LodEntry>();
  /** The objects by size, world units, the sizes sorted. */
  readonly sizes = new LodSizeIndex<LodEntry>();
  /** Objects whose form changed in the current update. */
  readonly changed = new Set<ObjectId>();
  /** Objects whose form is `hidden`. */
  readonly hidden = new Set<ObjectId>();
  /** The sizes on screen, device px, ascending, where an object's answer may change. */
  readonly edges: readonly number[];

  /**
   * Creates the state of a pass.
   *
   * @param name - The pass's name.
   * @param lod - Its rule and size.
   */
  constructor(
    readonly name: string,
    readonly lod: PassLevelOfDetail,
  ) {
    this.edges = lodEdgesOf(lod.rule);
  }

  /**
   * A new entry's per-threshold history.
   *
   * @returns One band per threshold of the rule.
   */
  newBands(): LodBand[] {
    return this.lod.rule.levels.map(() => ({ side: 0, transitions: 0, traversals: 0 }));
  }

  /**
   * The form of a level.
   *
   * @param level - A level.
   * @returns The rule's form.
   */
  formAt(level: number): LodForm {
    return lodFormAt(this.lod.rule, level);
  }

  /**
   * Moves an entry to the bucket of a new size.
   *
   * @param entry - The entry.
   * @param size - Its new size, world units.
   */
  resize(entry: LodEntry, size: number): void {
    this.sizes.place(entry, size);
  }

  /**
   * Drops an entry.
   *
   * @param entry - The entry.
   * @returns Whether it was hidden.
   */
  remove(entry: LodEntry): boolean {
    this.sizes.remove(entry);
    this.entries.delete(entry.id);
    this.changed.delete(entry.id);
    return this.hidden.delete(entry.id);
  }

  /**
   * Works out an entry's form at a scale, with hysteresis from its last one, and counts what
   * changed.
   *
   * @param entry - The entry.
   * @param scale - Device pixels per world unit.
   * @param counters - This frame's counts.
   * @param budget - The frame's remaining form changes. A change past it is deferred untouched
   *   (form, last size and band sides as they were), so it is worked out again next frame.
   * @returns Whether its hidden state flipped, or that the change was deferred.
   */
  evaluate(entry: LodEntry, scale: number, counters: LodCounters, budget: LodBudget): LodOutcome {
    const { rule } = this.lod;
    const px = entry.size * scale;
    const isFirst = Number.isNaN(entry.lastPx);
    const level = entry.size > 0 ? lodLevelOf(rule, px, isFirst ? undefined : entry.level) : 0;
    if (!isFirst && level !== entry.level && budget.remaining <= 0) return 'deferred';
    entry.lastPx = px;
    this.noteBandSides(entry, px);
    if (level === entry.level) return 'kept';
    const previous = entry.level;
    const wasHidden = this.formAt(previous) === 'hidden';
    entry.level = level;
    this.changed.add(entry.id);
    if (!isFirst) {
      budget.remaining -= 1;
      entry.transitions += 1;
      counters.lodTransitions += 1;
      if (this.isThrash(entry, previous, level)) counters.lodThrashes += 1;
    }
    const isHidden = this.formAt(level) === 'hidden';
    if (isHidden === wasHidden) return 'kept';
    if (isHidden) this.hidden.add(entry.id);
    else this.hidden.delete(entry.id);
    return 'flipped';
  }

  /**
   * Notes which side of each threshold's band a size is on, counting a traversal when it is the
   * other side from the last one seen.
   *
   * @param entry - The entry.
   * @param px - Its size on screen, device px.
   */
  private noteBandSides(entry: LodEntry, px: number): void {
    const { levels } = this.lod.rule;
    for (let index = 0; index < levels.length; index += 1) {
      const band = entry.bands[index];
      const side = bandSideOf(levels[index]?.belowPx ?? 0, px);
      if (band === undefined || side === 0) continue;
      if (band.side !== 0 && band.side !== side) band.traversals += 1;
      band.side = side;
    }
  }

  /**
   * Counts a change of form against each threshold it crossed and tells whether one of them now
   * has more changes than traversals of its band plus one (the no-thrash rule of).
   *
   * @param entry - The entry.
   * @param from - Its level before.
   * @param to - Its level now.
   * @returns Whether the change thrashed.
   */
  private isThrash(entry: LodEntry, from: number, to: number): boolean {
    let isThrash = false;
    // Threshold k separates level k from level k + 1.
    for (let index = Math.min(from, to); index < Math.max(from, to); index += 1) {
      const band = entry.bands[index];
      if (band === undefined) continue;
      band.transitions += 1;
      if (band.transitions > band.traversals + 1) isThrash = true;
    }
    return isThrash;
  }
}
