// The planner's record gathering and range building as they were before, one visible
// slot at a time: the reference `segment-plan-spans.test.ts` holds the span-at-a-time planner to.
// Test-only.
import type { DrawListEntry } from '../../draw-list.js';
import { assignSegments } from '../segment-groups.js';
import type { PassPageSpans } from '../segment-pages.js';
import type { PlannedPass, SegmentPlanInput } from '../segment-plan.js';
import { tableEntry } from '../table-entry.js';

/** One pass's visible live slots, gathered by {@link collectVisible}. */
interface PassRecords {
  readonly pass: PlannedPass;
  readonly passIndex: number;
  readonly slots: number[];
}

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

function collectVisible(input: SegmentPlanInput): {
  records: PassRecords[];
  passMaskByRank: Int32Array;
  sortedRanks: Int32Array;
  pageSpans: PassPageSpans[];
} {
  const records = input.passes.map((pass, passIndex) => ({ pass, passIndex, slots: [] }));
  const byName = new Map<string, PassRecords>(records.map((record) => [record.pass.name, record]));
  const offset = input.rankOffset ?? 0;
  const count = input.rankCount ?? input.isOccluderByRank.length - offset;
  const passMaskByRank = new Int32Array(count);
  const ranks: number[] = [];
  for (const { passName, ranges } of input.visible) {
    const target = byName.get(passName);
    if (!target) throw new RangeError(`The draw list names no scene pass "${passName}".`);
    const { rankOfSlot } = target.pass.owners;
    const hiddenRanks = target.pass.isHiddenByRank;
    const bit = 1 << target.passIndex;
    for (const { start, count } of ranges) {
      const end = Math.min(start + count, rankOfSlot.length);
      for (let slot = start; slot < end; slot += 1) {
        const owner = tableEntry(rankOfSlot, slot);
        const rank = owner - offset;
        if (owner >= 0 && (rank < 0 || rank >= passMaskByRank.length)) {
          throw new RangeError(`Visible slot ${String(slot)} is outside the rank window.`);
        }
        const isShown = hiddenRanks?.[owner] !== 1;
        if (owner >= 0 && isShown) {
          target.slots.push(slot);
          if (passMaskByRank[rank] === 0) ranks.push(rank);
          passMaskByRank[rank] = tableEntry(passMaskByRank, rank) | bit;
        }
      }
    }
  }
  return {
    records,
    passMaskByRank,
    sortedRanks: Int32Array.from(ranks).sort(),
    pageSpans: collectPageSpans(records, count, offset),
  };
}

function collectPageSpans(
  records: readonly PassRecords[],
  rankCount: number,
  rankOffset: number,
): PassPageSpans[] {
  const spans: PassPageSpans[] = [];
  for (const { pass, passIndex, slots } of records) {
    const { pageOfSlot } = pass;
    if (pageOfSlot === undefined) continue;
    if (slots.length === 0) continue;
    const minPageByRank = new Int32Array(rankCount).fill(2 ** 31 - 1);
    const maxPageByRank = new Int32Array(rankCount).fill(-1);
    for (const slot of slots) {
      const rank = tableEntry(pass.owners.rankOfSlot, slot) - rankOffset;
      const page = pageOfSlot[slot] ?? 0;
      minPageByRank[rank] = Math.min(tableEntry(minPageByRank, rank), page);
      maxPageByRank[rank] = Math.max(tableEntry(maxPageByRank, rank), page);
    }
    spans.push({
      passIndex,
      isPaintOrdered: pass.isPaintOrderedAcrossPages === true,
      minPageByRank,
      maxPageByRank,
    });
  }
  return spans;
}

function isSorted(values: readonly number[], compare: (a: number, b: number) => number): boolean {
  let previous: number | undefined;
  for (const value of values) {
    if (previous !== undefined && compare(previous, value) > 0) return false;
    previous = value;
  }
  return true;
}

function runsOf(records: PassRecords, segmentOfRank: Int32Array, rankOffset: number): SegmentRun[] {
  const { pass, passIndex, slots } = records;
  const { rankOfSlot, recordOfSlot } = pass.owners;
  const inPaintOrder = (a: number, b: number): number =>
    tableEntry(rankOfSlot, a) - tableEntry(rankOfSlot, b) ||
    tableEntry(recordOfSlot, a) - tableEntry(recordOfSlot, b);
  // Slots of a board built by appending are already in paint order: skip the sort then.
  if (!isSorted(slots, inPaintOrder)) slots.sort(inPaintOrder);
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
  for (const slot of slots) {
    const segment = tableEntry(segmentOfRank, tableEntry(rankOfSlot, slot) - rankOffset);
    const page = pass.pageOfSlot === undefined ? undefined : (pass.pageOfSlot[slot] ?? 0);
    if (segment !== currentSegment) {
      currentSegment = segment;
      runsByPage = new Map();
    }
    const run = runsByPage.get(page);
    const last = run?.ranges.at(-1);
    if (last && slot >= last.start + last.count && isFreeGap(last.start + last.count, slot)) {
      last.count = slot + 1 - last.start;
    } else if (run) {
      run.ranges.push({ start: slot, count: 1 });
    } else {
      const created = {
        segment,
        passIndex,
        passName: pass.name,
        page,
        ranges: [{ start: slot, count: 1 }],
      };
      runsByPage.set(page, created);
      runs.push(created);
    }
  }
  return runs;
}

/** What the per-slot reference plans: the draw list and the tables it rests on. */
export interface ReferencePlan {
  /** The draw list, segment-major. */
  readonly entries: DrawListEntry[];
  /** Per paint rank, the passes that draw a visible record of it. */
  readonly passMaskByRank: Int32Array;
  /** Per paint rank, its segment. */
  readonly segmentOfRank: Int32Array;
  /** The pages each visible object uses in each paged pass. */
  readonly pageSpans: readonly PassPageSpans[];
}

/**
 * `planSegmentDraws` as it was before: every visible slot gathered, sorted and joined
 * into ranges one at a time.
 *
 * @param input - The plan's input.
 * @returns The plan.
 */
export function planPerSlot(input: SegmentPlanInput): ReferencePlan {
  const offset = input.rankOffset ?? 0;
  const count = input.rankCount ?? input.isOccluderByRank.length - offset;
  const { records, passMaskByRank, sortedRanks, pageSpans } = collectVisible(input);
  const { segmentOfRank } = assignSegments(
    sortedRanks,
    passMaskByRank,
    input.isOccluderByRank.subarray(offset, offset + count),
    input.boundsOfRank && ((rank) => input.boundsOfRank?.(rank + offset)),
    pageSpans,
  );
  const runs = records.flatMap((record) => runsOf(record, segmentOfRank, offset));
  runs.sort(
    (a, b) => a.segment - b.segment || a.passIndex - b.passIndex || (a.page ?? 0) - (b.page ?? 0),
  );
  const entries = runs.map(({ passName, page, ranges }): DrawListEntry => {
    const copied = ranges.map(({ start, count: length }) => ({ start, count: length }));
    return page === undefined ? { passName, ranges: copied } : { passName, page, ranges: copied };
  });
  return { entries, passMaskByRank, segmentOfRank, pageSpans };
}
