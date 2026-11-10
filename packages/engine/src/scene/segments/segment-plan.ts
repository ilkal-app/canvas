import type { DrawListEntry } from '../draw-list.js';
import type { InstanceRange } from '../scene-culler.js';

import { assignSegments, type BoundsOfRank } from './segment-groups.js';
import type { PassPageSpans } from './segment-pages.js';
import { tableEntry } from './table-entry.js';
import { collectVisibleSpans, type PassSpans } from './visible-spans.js';

/** Who owns each slot of one pass's instance buffer, by paint rank. */
export interface SlotOwners {
  /** Per slot: its object's paint rank (0 paints first), or −1 for a free slot. */
  readonly rankOfSlot: Int32Array;
  /** Per slot: which of its object's records it holds in this pass, from 0. */
  readonly recordOfSlot: Int32Array;
}

/** One pass as the planner sees it. */
export interface PlannedPass {
  /** The pass's name, as the draw list names it. */
  readonly name: string;
  /** Who owns each slot of its instance buffer. */
  readonly owners: SlotOwners;
  /**
   * For a paged pass, each slot's page (`Scene.pagesOf`): its entries are split by page within
   * each segment. Absent for a pass that is not paged.
   */
  readonly pageOfSlot?: Int32Array;
  /**
   * Per paint rank, 1 when the pass leaves the object's records out at this level of detail
   * (the `hidden` form: `ScenePass.levelOfDetail`), as if culled. Absent: every record drawn.
   */
  readonly isHiddenByRank?: Uint8Array;
  /**
   * Whether the pass keeps paint order across pages (`ScenePass.isPaintOrderedAcrossPages`):
   * then an object on a lower page than one before it in its segment starts a new segment.
   */
  readonly isPaintOrderedAcrossPages?: boolean;
}

/** What {@link planSegments} needs. */
export interface SegmentPlanInput {
  /** First global paint rank; output rank tables start here. Defaults to 0. */
  readonly rankOffset?: number;
  /** Number of output ranks; defaults to the remaining global rank domain. */
  readonly rankCount?: number;
  /** The passes, in registered order. */
  readonly passes: readonly PlannedPass[];
  /** Per paint rank, 1 when the object is an opaque occluder. */
  readonly isOccluderByRank: Uint8Array;
  /** The visible records: the `cull` stage's draw list, ranges disjoint within a pass. */
  readonly visible: readonly DrawListEntry[];
  /**
   * Each rank's world box, so splits whose objects do not meet share a segment
   * (`assignSegments`); omitted, splits merge by their passes only.
   */
  readonly boundsOfRank?: BoundsOfRank;
}

/**
 * A frame's planned draws, from {@link planSegmentDraws}. Rank tables are local to the
 * requested rank window; GPU slot indices remain global.
 */
export interface SegmentPlan {
  /** The draw list, segment-major. */
  readonly entries: DrawListEntry[];
  /** Per paint rank, bit `p` set when pass `p` draws a visible record of it; 0 when hidden. */
  readonly passMaskByRank: Int32Array;
  /** Per paint rank, its segment; meaningful only where the pass mask is not 0. */
  readonly segmentOfRank: Int32Array;
  /** Per paint rank, its split within the plan (`assignSegments`); likewise. */
  readonly splitOfRank: Int32Array;
  /** How many segments the visible objects form. */
  readonly segmentCount: number;
  /** Whether a merge relied on boxes not meeting: the plan holds only while nothing moves. */
  readonly hasSpatialMerges: boolean;
  /**
   * The pages each visible object uses in each paged pass, for checking moves against a plan
   * that let pages fall, or merged splits drawing in one paged pass, where boxes did not meet.
   */
  readonly pageSpans: readonly PassPageSpans[];
}

/** A pass mask has one bit per pass. */
const MAX_PASSES = 32;

/** An instance range still being extended. */
interface OpenRange {
  start: number;
  count: number;
}

/** One pass's ranges within one segment (and page): a draw list entry to be. */
interface SegmentRun {
  readonly segment: number;
  readonly passIndex: number;
  readonly passName: string;
  /** The page, for a paged pass; else undefined. */
  readonly page: number | undefined;
  readonly ranges: OpenRange[];
}

/**
 * The order a pass's spans draw in: by paint rank, then record. A span holds an object's
 * records in record order, and two spans of one object never interleave, so this is the paint
 * order of every record in them.
 *
 * @param spans - The pass's visible spans.
 * @returns Their indexes in paint order.
 */
function paintOrderOf(spans: PassSpans): readonly number[] {
  const { rankOfSlot, recordOfSlot } = spans.pass.owners;
  const { starts } = spans;
  const order = starts.map((unused, index) => index);
  const compare = (a: number, b: number): number => {
    const slotA = starts[a] ?? 0;
    const slotB = starts[b] ?? 0;
    return (
      tableEntry(rankOfSlot, slotA) - tableEntry(rankOfSlot, slotB) ||
      tableEntry(recordOfSlot, slotA) - tableEntry(recordOfSlot, slotB)
    );
  };
  // Slots of a board built by appending are already in paint order: skip the sort then.
  for (let index = 1; index < order.length; index += 1) {
    if (compare(index - 1, index) > 0) return order.sort(compare);
  }
  return order;
}

/**
 * Turns one pass's visible spans into ranges per segment, in paint order: consecutive slots
 * join one range, and so do slots separated only by free slots (zeroed records draw nothing),
 * so deletions add no draws. A slot out of step with paint order starts a new range; that
 * fragmentation is the cost of storing records in slot order. Per span, not per record: a span's
 * slots are consecutive, so it extends whatever range its first slot joins or starts.
 *
 * @param spans - The pass's visible spans.
 * @param segmentOfRank - Each visible rank's segment.
 * @param rankOffset - The first global paint rank in the local table.
 * @returns The pass's runs, one per segment it draws in, in segment order.
 */
function runsOf(spans: PassSpans, segmentOfRank: Int32Array, rankOffset: number): SegmentRun[] {
  const { pass, passIndex, starts, ends } = spans;
  const { rankOfSlot } = pass.owners;
  const isFreeGap = (from: number, to: number): boolean => {
    for (let slot = from; slot < to; slot += 1) {
      if (tableEntry(rankOfSlot, slot) >= 0) return false;
    }
    return true;
  };
  const runs: SegmentRun[] = [];
  // The current segment's run per page (one entry, keyed undefined, for a pass that is not
  // paged): a new segment starts new runs.
  let runsByPage = new Map<number | undefined, SegmentRun>();
  let currentSegment = -1;
  for (const index of paintOrderOf(spans)) {
    const slot = starts[index] ?? 0;
    const end = ends[index] ?? slot + 1;
    const segment = tableEntry(segmentOfRank, tableEntry(rankOfSlot, slot) - rankOffset);
    const page = pass.pageOfSlot === undefined ? undefined : (pass.pageOfSlot[slot] ?? 0);
    if (segment !== currentSegment) {
      currentSegment = segment;
      runsByPage = new Map();
    }
    const run = runsByPage.get(page);
    const last = run?.ranges.at(-1);
    if (last && slot >= last.start + last.count && isFreeGap(last.start + last.count, slot)) {
      last.count = end - last.start;
    } else if (run) {
      run.ranges.push({ start: slot, count: end - slot });
    } else {
      const created = {
        segment,
        passIndex,
        passName: pass.name,
        page,
        ranges: [{ start: slot, count: end - slot }],
      };
      runsByPage.set(page, created);
      runs.push(created);
    }
  }
  return runs;
}

/**
 * Plans a frame's draws in z order: the visible records of every pass,
 * split into draw segments at opaque occluders (`assignSegments`) and emitted
 * segment-major, one `{ passName, ranges }` entry per segment and pass with visible records
 * (per segment, pass and page for a paged pass: `{ passName, page, ranges }`, pages ascending),
 * passes in registered order within a segment. Within an entry, records draw in paint order
 * (rank, then record index), coalesced into ranges of consecutive slots. A pass's records of
 * objects it hides at this level of detail (`isHiddenByRank`) are left out, as if culled.
 *
 * Draw calls are therefore bounded by segments × passes when each segment's records of a pass
 * sit in consecutive slots in paint order (a board built by appending), and grow with
 * fragmentation otherwise: an object reordered or re-slotted after its neighbours costs up to
 * two extra ranges until a compaction pass (not built yet) re-slots the buffer in paint order.
 * Pure; O(v) table reads in the visible records and O(s log s) in their spans (an object's
 * consecutive records, `collectVisibleSpans`), plus the free slots bridged.
 *
 * @param input - Passes, occluders, the visible ranges and boxes; not mutated.
 * @returns The draw list, segment-major.
 * @throws {RangeError} When a visible entry names no pass, there are more than 32 passes, or the rank window is invalid.
 */
export function planSegments(input: SegmentPlanInput): DrawListEntry[] {
  return planSegmentDraws(input).entries;
}

/**
 * {@link planSegments}, with what the plan found: its segment count, and whether it merged
 * splits because their objects' boxes do not meet (then a move can make it wrong).
 *
 * @param input - Passes, occluders, the visible ranges and boxes; not mutated.
 * @returns The draw list and what it rests on.
 * @throws {RangeError} When a visible entry names no pass, there are more than 32 passes, or the rank window is invalid.
 */
export function planSegmentDraws(input: SegmentPlanInput): SegmentPlan {
  if (input.passes.length > MAX_PASSES) {
    throw new RangeError(
      `Z-order segments support at most ${String(MAX_PASSES)} passes; received ${String(input.passes.length)}.`,
    );
  }
  const offset = input.rankOffset ?? 0;
  const count = input.rankCount ?? input.isOccluderByRank.length - offset;
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(count) ||
    offset < 0 ||
    count < 0 ||
    offset + count > input.isOccluderByRank.length
  ) {
    throw new RangeError('Invalid segment paint-rank window.');
  }
  const { spans, passMaskByRank, sortedRanks, pageSpans } = collectVisibleSpans(
    input.passes,
    input.visible,
    offset,
    count,
  );
  const { segmentOfRank, splitOfRank, segmentCount, hasSpatialMerges } = assignSegments(
    sortedRanks,
    passMaskByRank,
    input.isOccluderByRank.subarray(offset, offset + count),
    input.boundsOfRank && ((rank) => input.boundsOfRank?.(rank + offset)),
    pageSpans,
  );
  const runs = spans.flatMap((passSpans) => runsOf(passSpans, segmentOfRank, offset));
  runs.sort(
    (a, b) => a.segment - b.segment || a.passIndex - b.passIndex || (a.page ?? 0) - (b.page ?? 0),
  );
  const entries = runs.map(({ passName, page, ranges }): DrawListEntry => {
    const copied = ranges.map(({ start, count }): InstanceRange => ({ start, count }));
    return page === undefined ? { passName, ranges: copied } : { passName, page, ranges: copied };
  });
  return {
    entries,
    passMaskByRank,
    segmentOfRank,
    splitOfRank,
    segmentCount,
    hasSpatialMerges,
    pageSpans,
  };
}
