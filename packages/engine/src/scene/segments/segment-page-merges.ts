import type { WorldBounds } from '../../camera/camera.js';

import { SegmentOverlapGrid } from './segment-overlap-grid.js';
import type { PassPageSpans, SegmentPageBoxes } from './segment-pages.js';
import { tableEntry } from './table-entry.js';

/**
 * What merging a split into its segment would do to the paged passes that do not keep paint
 * order across pages: nothing (`none`: the split or the segment draws nothing in such a pass),
 * nothing because their boxes are apart (`apart`: the merge then rests on boxes), or draw a
 * record under one it paints over (`conflict`).
 */
export type PageMergeVerdict = 'none' | 'apart' | 'conflict';

/**
 * The segment's records in each paged pass that draws page by page without keeping paint order
 * across pages (the text pass: glyph atlas pages, greek bars on page 0), for `assignSegments`
 * (fix round 1). Within one split such a pass may draw a later object's records under an
 * earlier one's on a higher page, as the plan by passes alone does (a known limit: text rarely
 * meets text); but a split merged into its segment by boxes must add no such error, so a merge
 * is refused when an object of the split meets a record of the segment in the same pass on a
 * higher page than its own lowest. Built only when the planner has boxes; the plan by passes
 * alone never merges splits whose records share such a pass. Pure bookkeeping.
 */
export class SegmentPageMerges {
  private readonly spans: readonly PassPageSpans[];
  /** Per unordered paged pass, the segment's boxes keyed by their highest page. */
  private readonly grids: SegmentOverlapGrid[];
  /** Per unordered paged pass, whether the segment draws in it. */
  private readonly isUsed: boolean[];

  /**
   * Creates the bookkeeping for one plan.
   *
   * @param spans - Every paged pass's page spans; those that keep paint order are ignored.
   * @param boxes - The objects' boxes.
   */
  constructor(
    spans: readonly PassPageSpans[],
    private readonly boxes: SegmentPageBoxes,
  ) {
    this.spans = spans.filter(({ isPaintOrdered }) => !isPaintOrdered);
    this.grids = this.spans.map(() => new SegmentOverlapGrid(boxes.extent, boxes.count));
    this.isUsed = this.spans.map(() => false);
  }

  /**
   * What merging a split into the current segment would do.
   *
   * @param members - The split's ranks.
   * @returns The verdict.
   */
  verdictOf(members: Int32Array): PageMergeVerdict {
    let verdict: PageMergeVerdict = 'none';
    for (const [index, { minPageByRank, maxPageByRank }] of this.spans.entries()) {
      if (this.isUsed[index] !== true) continue;
      for (const rank of members) {
        if (tableEntry(maxPageByRank, rank) < 0) continue;
        verdict = 'apart';
        const minPage = tableEntry(minPageByRank, rank);
        if (this.grids[index]?.hasLaterOverlap(this.boxOf(rank), minPage) === true) {
          return 'conflict';
        }
      }
    }
    return verdict;
  }

  /**
   * Adds a closed split's records to the segment it joined or started.
   *
   * @param members - The split's ranks.
   * @param isNewSegment - Whether it started a new segment.
   */
  closeSplit(members: Int32Array, isNewSegment: boolean): void {
    for (const [index, { maxPageByRank }] of this.spans.entries()) {
      const grid = this.grids[index];
      if (isNewSegment) {
        grid?.clear();
        this.isUsed[index] = false;
      }
      for (const rank of members) {
        const page = tableEntry(maxPageByRank, rank);
        if (page < 0) continue;
        grid?.add(this.boxOf(rank), page);
        this.isUsed[index] = true;
      }
    }
  }

  private boxOf(rank: number): WorldBounds | undefined {
    return this.boxes.boxOf(rank);
  }
}
