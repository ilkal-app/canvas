// Text the glyph atlas changed for while it was off-screen: rewritten when it comes into
// view, not at once. Rewriting a text builds its quads, which ask for its missing glyphs at the
// tier of the scale now; after a zoom-in, thousands of texts left waiting from the overview asked
// for high-tier glyphs every frame though none was drawn, and flooded the atlas (mobile
// text-hanzi-10k: 6.5% hits, a full 76 MiB loan).
import type { ObjectId } from '@canvas/schema';

import type { VisibleObjects } from './text-tier-checks.js';

/**
 * Holds the texts an atlas change made stale while they were outside the visible set, and hands
 * each back once it enters it. Text the frame draws is rewritten at once, as before.
 */
export class OffscreenAtlasTexts {
  private readonly pending = new Set<ObjectId>();
  private checkedRevision = Number.NaN;

  /**
   * The texts waiting for view: outside the frame's visible set, so no frame draws them yet.
   *
   * @returns The waiting texts, live; read, never kept.
   */
  get waiting(): ReadonlySet<ObjectId> {
    return this.pending;
  }

  /**
   * Splits the texts an atlas change made stale: those the frame draws go to `stale`, the others
   * wait here; and the waiting texts that came into view since the last call go to `stale` too.
   * With no visible set (everything visible), every text goes to `stale`.
   *
   * @param changed - The texts the atlas change made stale; read, not kept.
   * @param visible - The frame's visible set.
   * @param stale - Collects the texts to rewrite now.
   * @param entries - The pass's text: a waiting text no longer in it is dropped.
   * @param mayWait - Whether a text may wait for view: not one that can draw outside its object's
   *   box, whose drawing bounds, published when it is rewritten, are what bring it into view.
   */
  take(
    changed: ReadonlySet<ObjectId>,
    visible: VisibleObjects,
    stale: Set<ObjectId>,
    entries: ReadonlyMap<ObjectId, unknown>,
    mayWait: (id: ObjectId) => boolean,
  ): void {
    const revision = visible.visibleRevision;
    const count = 'visibleCount' in visible ? visible.visibleCount : visible.visibleIds?.length;
    if (count === undefined) {
      for (const id of this.pending) stale.add(id);
      for (const id of changed) stale.add(id);
      this.pending.clear();
      this.checkedRevision = revision;
      return;
    }
    if (this.pending.size > 0 && revision !== this.checkedRevision) {
      this.takeEntered(visible, revision, count, stale);
    }
    this.checkedRevision = revision;
    for (const id of changed) {
      if (visible.isVisible(id) || !mayWait(id)) stale.add(id);
      else this.pending.add(id);
    }
    // Text deleted while waiting never comes into view: dropped once the waiting outnumber the
    // pass's text, so the set never grows past it.
    if (this.pending.size > entries.size) {
      for (const id of this.pending) if (!entries.has(id)) this.pending.delete(id);
    }
  }

  /**
   * Stops waiting for a text the pass forgot (deleted), so a text that later takes its id (an
   * undo) is not rewritten for an atlas change it never saw.
   *
   * @param id - The text.
   */
  forget(id: ObjectId): void {
    this.pending.delete(id);
  }

  /**
   * Moves the waiting texts now in view to `stale`: after one visible-set change, only those
   * that entered it; after more, the smaller of the waiting texts and the visible set is walked.
   *
   * @param visible - The frame's visible set.
   * @param revision - Its revision.
   * @param count - How many objects it holds.
   * @param stale - Collects the texts to rewrite now.
   */
  private takeEntered(
    visible: VisibleObjects,
    revision: number,
    count: number,
    stale: Set<ObjectId>,
  ): void {
    const { pending } = this;
    if (revision === this.checkedRevision + 1) {
      for (const id of visible.enteredIds) if (pending.delete(id)) stale.add(id);
    } else if (pending.size <= count) {
      for (const id of pending) {
        if (!visible.isVisible(id)) continue;
        pending.delete(id);
        stale.add(id);
      }
    } else {
      for (const id of visible.visibleIds ?? []) if (pending.delete(id)) stale.add(id);
    }
  }
}
