import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

import { highestPass, lowestPass } from './segment-groups.js';
import type { PassPageSpans } from './segment-pages.js';
import type { SegmentPlan } from './segment-plan.js';
import { tableEntry } from './table-entry.js';

/**
 * What z-order segments read of the culler's spatial index (`SceneSpatialIndex`): each object's
 * world box, and the objects whose boxes meet a rectangle.
 */
export interface SegmentSpatialIndex {
  /** Revision of asynchronous drawing bounds, which can change without a document edit. */
  readonly drawingBoundsRevision?: number;
  /**
   * Which objects each recent drawing-bounds revision changed (
   * `SceneSpatialIndex.drawingChanges`); absent, any such change plans in full.
   */
  readonly drawingChanges?: {
    /**
     * The objects whose drawing boxes changed after a revision.
     *
     * @param revision - The reader's last revision.
     * @returns Their ids, or undefined when the log cannot say.
     */
    since(revision: number): readonly ObjectId[] | undefined;
  };
  /**
   * An object's world box.
   *
   * @param id - The object.
   * @returns Its box, world units, or `undefined` when it has none.
   */
  boundsOf(id: ObjectId): WorldBounds | undefined;
  /**
   * An object's world box without the drawing bounds a text pass added (a frame's name), clipped
   * as its box is; omitted, layers measure frames by `boundsOf`.
   *
   * @param id - The object.
   * @returns Its box, or `undefined` when it has none.
   */
  boundsWithoutDrawingOf?(id: ObjectId): WorldBounds | undefined;
  /**
   * The objects whose world boxes meet a rectangle, edges included.
   *
   * @param rect - The rectangle, world units.
   * @returns Their ids, in no particular order.
   */
  searchRect(rect: WorldBounds): readonly ObjectId[];
  /**
   * Whether an object's clipping frames leave nothing of it, so it has no box yet
   * draws nothing and meets nothing.
   *
   * @param id - The object.
   * @returns True when it is clipped away.
   */
  isClippedAway?(id: ObjectId): boolean;
  /**
   * Whether a retained move is placing an object, so its box moves every frame
   * without a change set and a plan must not rely on it.
   *
   * @param id - The object.
   * @returns True while it moves.
   */
  isMoving?(id: ObjectId): boolean;
}

/**
 * What moved objects do to a plan that merged segments by their boxes: it still holds
 * (`kept`), a moved object now meets content its merge relied on missing (`broken`), or more
 * visible objects moved than are worth checking (`tooMany`).
 */
export type MoveVerdict = 'kept' | 'broken' | 'tooMany';

/**
 * Whether a plan still draws the same after some of its objects moved. A plan that
 * merged two splits by their boxes stays right while no object of one split meets an object of
 * an earlier split of its segment that draws in a later pass than the first's lowest; only pairs
 * with a moved object can have changed, so each moved object the plan drew is looked up in the
 * spatial index at its new box and checked against what it meets there, in either order. An
 * object moved to where it has no box is taken to meet everything, unless its clipping frames
 * leave nothing of it (`isClippedAway`), when it meets nothing. O(moved × (log n + met)).
 * Pure.
 *
 * @param plan - The plan, with its per-rank pass masks, segments and splits.
 * @param moved - The ids of the objects whose boxes may have changed, descendants included.
 * @param rankOf - An object's paint rank, or `undefined` for one the plan never saw.
 * @param spatial - The spatial index, already holding the new boxes.
 * @param limit - The most moved objects of the plan to check; past it, `tooMany`.
 * @param closingRankOf - An object's closing rank (a frame's outline, drawn after
 *   its descendants), checked with its box as its own rank is; default none.
 * @returns The verdict.
 */
export function checkMovedObjects(
  plan: SegmentPlan,
  moved: Iterable<ObjectId>,
  rankOf: (id: ObjectId) => number | undefined,
  spatial: SegmentSpatialIndex,
  limit: number,
  closingRankOf: (id: ObjectId) => number | undefined = () => undefined,
): MoveVerdict {
  const { passMaskByRank } = plan;
  const planned = (rank: number | undefined): number =>
    rank === undefined || tableEntry(passMaskByRank, rank) === 0 ? -1 : rank;
  let checked = 0;
  for (const id of moved) {
    const ranks = [planned(rankOf(id)), planned(closingRankOf(id))].filter((rank) => rank >= 0);
    if (ranks.length === 0) continue;
    checked += 1;
    if (checked > limit) return 'tooMany';
    const box = spatial.boundsOf(id);
    if (box === undefined) {
      // Clipped away, it draws nothing, so no order it is drawn in can be wrong.
      if (spatial.isClippedAway?.(id) === true) continue;
      return 'broken';
    }
    const metIds = spatial.searchRect(box);
    for (const rank of ranks) {
      for (const metId of metIds) {
        if (
          breaksMerge(plan, rank, planned(rankOf(metId))) ||
          breaksMerge(plan, rank, planned(closingRankOf(metId)))
        ) {
          return 'broken';
        }
      }
    }
  }
  return 'kept';
}

/** A plan and what moved since, for {@link verdictOfMoves}. */
export interface PlanMoves {
  /** The spatial index, already holding the new boxes; absent, nothing is checked. */
  readonly spatial: SegmentSpatialIndex | undefined;
  /** The last plan, absent before the first. */
  readonly lastPlan: SegmentPlan | undefined;
  /** A layered plan, when the last one was. */
  readonly layered: { readonly hasSpatialMerges: boolean } | undefined;
  /** Whether the last plan merged by passes only, because too many objects moved. */
  readonly isPlannedWithoutBoxes: boolean;
  /** The objects updated this frame. */
  readonly moved: ReadonlySet<ObjectId>;
  /**
   * The objects and their descendants.
   *
   * @param ids - The objects.
   * @returns Them and every descendant.
   */
  descendants(ids: Iterable<ObjectId>): Iterable<ObjectId>;
  /**
   * Each object's paint rank, built on demand.
   *
   * @returns The ranks.
   */
  ranks(): ReadonlyMap<ObjectId, number>;
  /**
   * Each closing rank, after `ranks`.
   *
   * @returns The ranks.
   */
  closingRanks(): ReadonlyMap<ObjectId, number>;
}

/**
 * What a frame's moves do to the z-order segments' last plan: nothing to check without a spatial
 * index or when nothing moved; a layered plan that merged by boxes is re-made when anything
 * moves; a plan made without boxes is kept while objects move and re-made, with boxes, once
 * nothing does; a plan that merged by boxes is checked against the moved objects and their
 * descendants (`checkMovedObjects`, at most `MAX_CHECKED_MOVES`).
 *
 * @param input - The plan and the moves.
 * @param limit - The most moved objects to check.
 * @returns `kept`, `broken` (re-plan with boxes) or `tooMany` (re-plan without them).
 */
export function verdictOfMoves(input: PlanMoves, limit: number): MoveVerdict {
  const { spatial, lastPlan, layered, moved } = input;
  if (spatial === undefined || lastPlan === undefined) return 'kept';
  if (layered) return moved.size > 0 && layered.hasSpatialMerges ? 'broken' : 'kept';
  if (input.isPlannedWithoutBoxes) return moved.size === 0 ? 'broken' : 'kept';
  if (!lastPlan.hasSpatialMerges || moved.size === 0) return 'kept';
  const rankById = input.ranks();
  const closingRankById = input.closingRanks();
  return checkMovedObjects(
    lastPlan,
    input.descendants(moved),
    (id) => rankById.get(id),
    spatial,
    limit,
    (id) => closingRankById.get(id),
  );
}

/**
 * Whether two planned ranks whose boxes meet were merged into one segment from different splits
 * in an order the union draws wrong: the later split's lowest pass under the earlier split's
 * highest, or a page fall between them.
 *
 * @param plan - The plan.
 * @param rank - The moved rank.
 * @param met - A rank it meets, or −1 for none.
 * @returns True when the merge no longer holds.
 */
function breaksMerge(plan: SegmentPlan, rank: number, met: number): boolean {
  const { passMaskByRank, segmentOfRank, splitOfRank } = plan;
  const split = tableEntry(splitOfRank, rank);
  const metSplit = tableEntry(splitOfRank, met);
  if (met < 0 || metSplit === split) return false;
  if (tableEntry(segmentOfRank, met) !== tableEntry(segmentOfRank, rank)) return false;
  const mask = tableEntry(passMaskByRank, rank);
  const metMask = tableEntry(passMaskByRank, met);
  // The later split's lowest pass under the earlier split's highest: the union reorders them.
  const [earlier, later] = metSplit < split ? [metMask, mask] : [mask, metMask];
  if (lowestPass(later) < highestPass(earlier)) return true;
  const [earlierRank, laterRank] = metSplit < split ? [met, rank] : [rank, met];
  return hasPageFall(plan.pageSpans, earlierRank, laterRank);
}

/**
 * Whether a later object uses a lower page than an earlier one in a paged pass: drawn page by
 * page in one segment, the later would go under the earlier (images, and since fix
 * round 1 text, whose merges by boxes are refused on the same condition).
 *
 * @param spans - The plan's page spans.
 * @param earlier - The earlier object's rank.
 * @param later - The later object's rank.
 * @returns Whether their pages fall.
 */
function hasPageFall(spans: readonly PassPageSpans[], earlier: number, later: number): boolean {
  return spans.some(
    ({ minPageByRank, maxPageByRank }) =>
      tableEntry(maxPageByRank, later) >= 0 &&
      tableEntry(maxPageByRank, earlier) >= 0 &&
      tableEntry(minPageByRank, later) < tableEntry(maxPageByRank, earlier),
  );
}
