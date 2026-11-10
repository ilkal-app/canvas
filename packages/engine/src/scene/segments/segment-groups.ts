import type { WorldBounds } from '../../camera/camera.js';

import { SegmentOverlapGrid } from './segment-overlap-grid.js';
import { SegmentPageMerges } from './segment-page-merges.js';
import { SegmentPageOrder, type PassPageSpans, type SegmentPageBoxes } from './segment-pages.js';
import { tableEntry } from './table-entry.js';

/** The draw segment of every visible object, from {@link assignSegments}. */
export interface SegmentAssignment {
  /** Per paint rank: its segment, from 0. Meaningful only for the visible ranks. */
  readonly segmentOfRank: Int32Array;
  /**
   * Per paint rank: its split (an occluder and the non-occluders up to the next), from 0, in
   * paint order. Meaningful only for the visible ranks.
   */
  readonly splitOfRank: Int32Array;
  /** How many segments the visible objects form. */
  readonly segmentCount: number;
  /**
   * Whether some split joined its segment only because their boxes do not meet: the assignment
   * then holds only while the objects stay where they are.
   */
  readonly hasSpatialMerges: boolean;
}

/**
 * The lowest pass index in a pass mask.
 *
 * @param mask - A non-empty pass mask.
 * @returns The index of its lowest set bit.
 */
export function lowestPass(mask: number): number {
  return 31 - Math.clz32(mask & -mask);
}

/**
 * The highest pass index in a pass mask.
 *
 * @param mask - A non-empty pass mask.
 * @returns The index of its highest set bit.
 */
export function highestPass(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Where each visible object draws, for merging segments that do not overlap. */
export type BoundsOfRank = (rank: number) => WorldBounds | undefined;

/**
 * The union of the visible objects' boxes.
 *
 * @param sortedRanks - The visible ranks.
 * @param boundsOfRank - Each rank's box.
 * @returns The union, or `undefined` when none has a box.
 */
function extentOf(sortedRanks: Int32Array, boundsOfRank: BoundsOfRank): WorldBounds | undefined {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rank of sortedRanks) {
    const bounds = boundsOfRank(rank);
    if (bounds === undefined) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Splits the visible objects, in paint order, into draw segments (opaque occluders start z-order
 * segments; the prototype's `beginSegment` before each note,
 * `webgl-whiteboard/src/render/renderer.ts`). Each segment is drawn pass by pass in registered
 * order, so everything in a segment draws over everything in earlier segments, and an occluder
 * starting a segment covers every earlier object, whatever pass drew it.
 *
 * Each split is kept only when it matters. Drawing segment A and then B pass by pass differs
 * from drawing their union pass by pass only where a record of B in some pass meets a record of
 * A in a later pass (the union draws A's over B's). So B joins A when every pass A uses comes no
 * later than every pass B uses (stacked notes, a board of filled shapes in one pass); and, given
 * `boundsOfRank`, also when no object of B meets an object of A that draws in a later pass than
 * B's object's lowest (a note that covers no text before it needs no segment of its own,
 * so a board of notes with text is not a segment per note). A board with no occluders is one
 * segment, as in the prototype. A paged pass is drawn page by page within a segment, so for a
 * pass that keeps paint order across pages (images), an object whose pages come before a page
 * an earlier object of its segment used starts a new segment, whether it occludes or not, and
 * never joins the one before (`SegmentPageOrder`: two overlapping images on different
 * textures stay in paint order); given boxes, only where it meets a record on a higher page.
 * A paged pass that does not keep paint order across pages (text) never starts a
 * split, but a merge by boxes is refused where an object of the split meets a record of the
 * segment in that pass on a higher page (`SegmentPageMerges`, fix round 1: text meeting
 * text across an occluder, a greek bar on page 0 over glyphs on page 1). Pure; O(n) in the
 * visible objects without boxes, plus the grid's cost (`SegmentOverlapGrid`) with them.
 *
 * @param sortedRanks - The visible objects' paint ranks, ascending.
 * @param passMaskByRank - Per rank, bit `p` set when pass `p` draws a visible record of it
 *   (bit 31 makes the entry negative; the bit arithmetic does not mind).
 * @param isOccluderByRank - Per rank, 1 when the object is an opaque occluder.
 * @param boundsOfRank - Each rank's world box (`undefined`: drawn without one, meets everything);
 *   omitted, splits are merged by their passes only.
 * @param pageSpans - The pages of the paged passes; none by default.
 * @returns Each visible rank's segment, the segment count, and whether any merge relied on boxes.
 */
export function assignSegments(
  sortedRanks: Int32Array,
  passMaskByRank: Int32Array,
  isOccluderByRank: Uint8Array,
  boundsOfRank?: BoundsOfRank,
  pageSpans: readonly PassPageSpans[] = [],
): SegmentAssignment {
  const segmentOfRank = new Int32Array(passMaskByRank.length);
  const splitOfRank = new Int32Array(passMaskByRank.length);
  let split = -1;
  const boxOf: BoundsOfRank = boundsOfRank ?? (() => undefined);
  const extent = boundsOfRank === undefined ? undefined : extentOf(sortedRanks, boundsOfRank);
  const grid =
    boundsOfRank === undefined ? undefined : new SegmentOverlapGrid(extent, sortedRanks.length);
  let segment = -1;
  /** Whether a merge relied on boxes (set inside `closeSplit`). */
  const merges = { isSpatial: false };
  /** The highest pass the current segment uses. */
  let segmentHighest = 0;
  /** The split being gathered: where it starts in `sortedRanks`, and its pass span. */
  let splitStart = 0;
  let splitLowest = 0;
  let splitHighest = 0;
  const { pages, pageMerges } = pageBookkeeping(pageSpans, boundsOfRank, extent, sortedRanks);
  /**
   * Whether a split drawn after the current segment would cover something of it.
   *
   * @param split - The split's ranks.
   * @returns Whether one of its objects meets later-pass content of the segment.
   */
  const coversSegment = (split: Int32Array): boolean =>
    grid === undefined ||
    split.some((rank) => {
      const lowest = lowestPass(tableEntry(passMaskByRank, rank));
      return lowest < segmentHighest && grid.hasLaterOverlap(boxOf(rank), lowest);
    });
  const closeSplit = (end: number): void => {
    const members = sortedRanks.subarray(splitStart, end);
    split += 1;
    const pageMerge = pageMerges?.verdictOf(members) ?? 'none';
    const isNewSegment =
      segment < 0 ||
      pages.shouldStartSegment ||
      (splitLowest < segmentHighest && coversSegment(members)) ||
      pageMerge === 'conflict';
    pages.closeSplit(isNewSegment);
    pageMerges?.closeSplit(members, isNewSegment);
    if (isNewSegment) {
      segment += 1;
      segmentHighest = splitHighest;
      grid?.clear();
    } else {
      if (splitLowest < segmentHighest || pageMerge === 'apart') merges.isSpatial = true;
      segmentHighest = Math.max(segmentHighest, splitHighest);
    }
    for (const rank of members) {
      segmentOfRank[rank] = segment;
      splitOfRank[rank] = split;
      grid?.add(boxOf(rank), highestPass(tableEntry(passMaskByRank, rank)));
    }
  };
  sortedRanks.forEach((rank, index) => {
    const mask = tableEntry(passMaskByRank, rank);
    const fall = index > 0 ? pages.fallOf(rank) : 'none';
    if (index === 0 || fall !== 'none' || isOccluderByRank[rank] === 1) {
      if (index > 0) closeSplit(index);
      splitStart = index;
      splitLowest = lowestPass(mask);
      splitHighest = highestPass(mask);
      pages.startSplit(fall === 'segment');
    } else {
      splitLowest = Math.min(splitLowest, lowestPass(mask));
      splitHighest = Math.max(splitHighest, highestPass(mask));
    }
    pages.add(rank);
  });
  if (sortedRanks.length > 0) closeSplit(sortedRanks.length);
  const hasSpatialMerges = merges.isSpatial || pages.didMergeByBoxes;
  return { segmentOfRank, splitOfRank, segmentCount: segment + 1, hasSpatialMerges };
}

/**
 * The page bookkeeping of one plan: the page order of the passes that keep paint order across
 * pages, and, given boxes, the merge guard of those that do not.
 *
 * @param pageSpans - The paged passes' page spans.
 * @param boundsOfRank - Each rank's box, or `undefined` without boxes.
 * @param extent - Their union.
 * @param sortedRanks - The visible ranks.
 * @returns Both.
 */
function pageBookkeeping(
  pageSpans: readonly PassPageSpans[],
  boundsOfRank: BoundsOfRank | undefined,
  extent: WorldBounds | undefined,
  sortedRanks: Int32Array,
): { pages: SegmentPageOrder; pageMerges: SegmentPageMerges | undefined } {
  const boxes = pageBoxes(boundsOfRank, extent, sortedRanks);
  const pageMerges = boxes === undefined ? undefined : new SegmentPageMerges(pageSpans, boxes);
  return { pages: new SegmentPageOrder(pageSpans, boxes), pageMerges };
}

/**
 * What the page bookkeeping needs of the boxes, when there are boxes.
 *
 * @param boundsOfRank - Each rank's box, or `undefined` without boxes.
 * @param extent - Their union.
 * @param sortedRanks - The visible ranks.
 * @returns The boxes for `SegmentPageOrder`, or `undefined`.
 */
function pageBoxes(
  boundsOfRank: BoundsOfRank | undefined,
  extent: WorldBounds | undefined,
  sortedRanks: Int32Array,
): SegmentPageBoxes | undefined {
  return boundsOfRank === undefined
    ? undefined
    : { boxOf: boundsOfRank, extent, count: sortedRanks.length };
}
