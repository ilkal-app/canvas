import type { WorldBounds } from '../../camera/camera.js';
import { intersectsBounds } from '../../spatial/bounds.js';

import { SegmentOverlapGrid } from './segment-overlap-grid.js';
import { tableEntry } from './table-entry.js';

/**
 * The pages each visible object's records use in one paged pass, by paint rank: the lowest and
 * the highest; −1 as the highest for an object the pass does not draw.
 */
export interface PassPageSpans {
  /** The pass's index in registered order (its bit in the pass masks). */
  readonly passIndex: number;
  /**
   * Whether the pass keeps paint order across pages (`ScenePass.isPaintOrderedAcrossPages`,
   * images): a fall in pages then starts a split (`SegmentPageOrder`); else (text) it only
   * refuses merges by boxes that would draw a record under one it paints over
   * (`SegmentPageMerges`).
   */
  readonly isPaintOrdered: boolean;
  /** Per rank: the lowest page of its visible records in the pass. */
  readonly minPageByRank: Int32Array;
  /** Per rank: the highest page, or −1 when the pass draws none of its records. */
  readonly maxPageByRank: Int32Array;
}

/** An object's box and the highest page it uses in one paged pass. */
interface PagedBox {
  readonly bounds: WorldBounds | undefined;
  readonly page: number;
}

/**
 * What an object's pages ask of the split it is in (`SegmentPageOrder.fallOf`): nothing; a split
 * of its own, which may still join its segment by the usual overlap rule (its pages fall, but it
 * meets no record on a higher page); or a split that starts a segment (it meets one).
 */
export type PageFall = 'none' | 'split' | 'segment';

/** What {@link SegmentPageOrder} is built with when the planner has boxes. */
export interface SegmentPageBoxes {
  /** Each rank's world box; `undefined` meets everything. */
  readonly boxOf: (rank: number) => WorldBounds | undefined;
  /** The union of the visible boxes, to size the grids. */
  readonly extent: WorldBounds | undefined;
  /** About how many objects will be added. */
  readonly count: number;
}

/**
 * The pages the current segment and the split being gathered use in each paged pass that keeps
 * paint order across pages, for `assignSegments`: a segment draws a paged pass page by
 * page, so an object whose pages come before a page already used in its segment would draw under
 * records it paints over (two overlapping images on different textures). Such an object starts
 * a split that must start a segment of its own. Given boxes, only an object that meets
 * a record on a higher page does; one that meets none starts a split that joins its segment when
 * the usual overlap rule allows (it covers no later-pass content before it), so images apart on
 * a board draw page by page in one segment, whatever order their atlas pages were made in
 * (`SegmentOverlapGrid`, keyed by page), and the plan then rests on boxes (`didMergeByBoxes`),
 * which moves are checked against (`checkMovedObjects`). Pure
 * bookkeeping; O(paged passes) per call, plus the grids' cost with boxes.
 */
export class SegmentPageOrder {
  /** The highest page each paged pass uses in the current segment. */
  private readonly segmentPages: Int32Array;
  /** The same within the split being gathered, which may join the segment. */
  private readonly splitPages: Int32Array;
  /** Per paged pass, the current segment's boxes by page; absent without boxes. */
  private readonly segmentGrids: SegmentOverlapGrid[] | undefined;
  /** Per paged pass, the split's boxes and pages. */
  private readonly splitBoxes: PagedBox[][];
  /** Whether the split being gathered starts a segment of its own. */
  private isSplitAlone = false;
  private hasBoxMerges = false;

  private readonly spans: readonly PassPageSpans[];

  /**
   * Creates the bookkeeping for one plan.
   *
   * @param spans - The paged passes' page spans; only those that keep paint order are read.
   * @param boxes - The objects' boxes; without them any fall in pages starts a segment.
   */
  constructor(
    spans: readonly PassPageSpans[],
    private readonly boxes?: SegmentPageBoxes,
  ) {
    this.spans = spans.filter(({ isPaintOrdered }) => isPaintOrdered);
    this.segmentPages = new Int32Array(this.spans.length).fill(-1);
    this.splitPages = new Int32Array(this.spans.length).fill(-1);
    this.segmentGrids =
      boxes === undefined
        ? undefined
        : this.spans.map(() => new SegmentOverlapGrid(boxes.extent, boxes.count));
    this.splitBoxes = this.spans.map(() => []);
  }

  /**
   * Whether the split being gathered must start a segment of its own.
   *
   * @returns True when its first object's pages demanded it.
   */
  get shouldStartSegment(): boolean {
    return this.isSplitAlone;
  }

  /**
   * Whether some object was kept in its segment although its pages fall, because it meets no
   * record on a higher page: the plan then holds only while the objects stay apart.
   *
   * @returns True when a box decided.
   */
  get didMergeByBoxes(): boolean {
    return this.hasBoxMerges;
  }

  /**
   * What an object's pages ask of its split: whether they come before a page already used where
   * it would draw, in the split being gathered and, unless that split starts a segment of its
   * own, in the current segment (checked as if the split joins it; a split that does not is only
   * stricter). Without boxes a fall starts a segment; with them, only a fall that meets a record
   * on a higher page does, and any other fall starts a split.
   *
   * @param rank - The object's paint rank.
   * @returns What the object's pages ask.
   */
  fallOf(rank: number): PageFall {
    let fall: PageFall = 'none';
    for (const [index, { minPageByRank, maxPageByRank }] of this.spans.entries()) {
      const segment = this.isSplitAlone ? -1 : tableEntry(this.segmentPages, index);
      const used = Math.max(segment, tableEntry(this.splitPages, index));
      const minPage = tableEntry(minPageByRank, rank);
      if (tableEntry(maxPageByRank, rank) < 0 || minPage >= used) continue;
      if (this.isCoveredOnHigherPage(index, rank, minPage)) return 'segment';
      fall = 'split';
    }
    if (fall === 'split') this.hasBoxMerges = true;
    return fall;
  }

  /**
   * Whether an object meets a record on a higher page in the split or, unless the split is
   * alone, the segment; always, without boxes.
   *
   * @param index - The paged pass's index among the spans.
   * @param rank - The object's paint rank.
   * @param minPage - Its lowest page in the pass.
   * @returns Whether it must start a segment.
   */
  private isCoveredOnHigherPage(index: number, rank: number, minPage: number): boolean {
    if (this.boxes === undefined) return true;
    const bounds = this.boxes.boxOf(rank);
    const isInSplit =
      this.splitBoxes[index]?.some((box) => box.page > minPage && meets(box.bounds, bounds)) ===
      true;
    return (
      isInSplit ||
      (!this.isSplitAlone && this.segmentGrids?.[index]?.hasLaterOverlap(bounds, minPage) === true)
    );
  }

  /**
   * Starts a new split.
   *
   * @param isAlone - Whether it must start a segment of its own.
   */
  startSplit(isAlone: boolean): void {
    this.isSplitAlone = isAlone;
    this.splitPages.fill(-1);
  }

  /**
   * Adds an object's pages to the split being gathered.
   *
   * @param rank - The object's paint rank.
   */
  add(rank: number): void {
    this.spans.forEach(({ maxPageByRank }, index) => {
      const page = tableEntry(maxPageByRank, rank);
      this.splitPages[index] = Math.max(tableEntry(this.splitPages, index), page);
      if (this.boxes !== undefined && page >= 0) {
        this.splitBoxes[index]?.push({ bounds: this.boxes.boxOf(rank), page });
      }
    });
  }

  /**
   * Closes the split being gathered into the segments.
   *
   * @param isNewSegment - Whether it started a new segment (else it joined the current one).
   */
  closeSplit(isNewSegment: boolean): void {
    this.spans.forEach((unused, index) => {
      const split = tableEntry(this.splitPages, index);
      const segment = isNewSegment ? -1 : tableEntry(this.segmentPages, index);
      this.segmentPages[index] = Math.max(segment, split);
      const grid = this.segmentGrids?.[index];
      const boxes = this.splitBoxes[index] ?? [];
      if (isNewSegment) grid?.clear();
      for (const { bounds, page } of boxes) grid?.add(bounds, page);
      boxes.length = 0;
    });
  }
}

/**
 * Whether two boxes meet, edges included; a missing box meets everything.
 *
 * @param a - One box.
 * @param b - The other.
 * @returns Whether they meet.
 */
function meets(a: WorldBounds | undefined, b: WorldBounds | undefined): boolean {
  return a === undefined || b === undefined || intersectsBounds(a, b);
}
