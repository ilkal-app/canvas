import type { ObjectId } from '@canvas/schema';

import { mayChangeTier } from '../atlas/glyph-tiers.js';

/** What the tier checks read of the level of detail: which objects the frame draws. */
export interface VisibleObjects {
  /** A revision that goes up by one whenever the visible set changes. */
  readonly visibleRevision: number;
  /** The visible set; `undefined` when every object is visible. */
  readonly visibleIds: readonly ObjectId[] | undefined;
  /** Optional cheap count, avoiding materializing a legacy array. */
  readonly visibleCount?: number | undefined;
  /** The objects that entered the visible set at its last change (revision `visibleRevision`). */
  readonly enteredIds: readonly ObjectId[];
  /**
   * Whether an object is in the visible set.
   *
   * @param id - The object.
   * @returns True when the frame draws it.
   */
  isVisible(id: ObjectId): boolean;
}

/**
 * Which text objects the text pass must check for a new glyph tier (tiers switch with
 * hysteresis). A zoom queues every text object only when it takes some
 * font size in use across a tier edge (`mayChangeTier`: a few frames of a sweep), not on every
 * scale change, and hands out the queued objects the frame draws: a zoom frame costs O(font
 * sizes) and an off-screen object is checked when it comes into view. After each hand-out no
 * queued object is visible, so when the visible set then changes only the objects that entered
 * it are looked up in the queue (fix round 1): a pan costs O(entering), not O(queued), with
 * 18,000 texts queued off screen on the 50k board. The frame's thread.
 */
export class TextTierChecks {
  private readonly pending = new Set<ObjectId>();
  private readonly fontSizes = new Set<number>();
  /** The last hand-out, reused from frame to frame. */
  private readonly handedOut: ObjectId[] = [];
  private hasQueued = false;
  private checkedRevision = Number.NaN;

  /**
   * Notes the font sizes an object's text uses, world units.
   *
   * @param sizes - The sizes.
   */
  noteFontSizes(sizes: Iterable<number>): void {
    for (const size of sizes) this.fontSizes.add(size);
  }

  /**
   * Queues every text object when a scale change may change a tier.
   *
   * @param fromScale - The scale before, device px per world unit.
   * @param toScale - The scale now.
   * @param ids - Every text object.
   */
  rescale(fromScale: number, toScale: number, ids: Iterable<ObjectId>): void {
    let canChange = false;
    for (const size of this.fontSizes) {
      if (mayChangeTier(size * fromScale, size * toScale)) canChange = true;
    }
    if (!canChange) return;
    for (const id of ids) this.pending.add(id);
    this.hasQueued = true;
  }

  /**
   * Takes the queued objects the frame draws; the others stay queued until they come into view.
   * After a queueing, or when a visible set was missed, the smaller of the queue and the visible
   * set is walked; when the set changed by one revision since the last call, only the objects
   * that entered it.
   *
   * @param visible - The frame's visible set.
   * @returns The objects to check now: an array reused by the next call.
   */
  due(visible: VisibleObjects): readonly ObjectId[] {
    const { handedOut, pending } = this;
    handedOut.length = 0;
    const revision = visible.visibleRevision;
    if (!this.hasQueued && revision === this.checkedRevision) return handedOut;
    const isNextSet = revision === this.checkedRevision + 1;
    const count = 'visibleCount' in visible ? visible.visibleCount : visible.visibleIds?.length;
    if (count === undefined) {
      for (const id of pending) handedOut.push(id);
      pending.clear();
    } else if (!this.hasQueued && isNextSet) {
      for (const id of visible.enteredIds) if (pending.delete(id)) handedOut.push(id);
    } else if (pending.size <= count) {
      for (const id of pending) {
        if (!visible.isVisible(id)) continue;
        pending.delete(id);
        handedOut.push(id);
      }
    } else {
      for (const id of visible.visibleIds ?? []) if (pending.delete(id)) handedOut.push(id);
    }
    this.hasQueued = false;
    this.checkedRevision = revision;
    return handedOut;
  }

  /**
   * Forgets an object.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.pending.delete(id);
  }
}
