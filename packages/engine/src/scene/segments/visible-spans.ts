import type { DrawListEntry } from '../draw-list.js';

import type { PassPageSpans } from './segment-pages.js';
import type { PlannedPass } from './segment-plan.js';
import { tableEntry } from './table-entry.js';

/**
 * One pass's visible records as spans: each span is consecutive slots holding consecutive
 * records of one object, from its first record up, on one page. A text object's glyphs, laid
 * out in slot order, are one span, so the planner's work grows with visible objects rather than
 * visible records (a zoomed-out board on a ratio-2 screen keeps about four times the
 * glyph records of a ratio-1 one, as greek bars).
 */
export interface PassSpans {
  /** The pass. */
  readonly pass: PlannedPass;
  /** Its index in registered order: its bit in the pass masks. */
  readonly passIndex: number;
  /** Per span, its first slot. */
  readonly starts: number[];
  /** Per span, the slot after its last. */
  readonly ends: number[];
}

/** What {@link collectVisibleSpans} gathers. */
export interface VisibleSpans {
  /** Every pass's visible spans, in slot order. */
  readonly spans: PassSpans[];
  /** Per paint rank (local to the window), bit `p` set when pass `p` draws a visible record. */
  readonly passMaskByRank: Int32Array;
  /** The visible ranks (local), ascending. */
  readonly sortedRanks: Int32Array;
  /** The pages each visible object uses in each paged pass. */
  readonly pageSpans: PassPageSpans[];
}

/**
 * The page of a slot in a paged pass: slots past its page table are on page 0.
 *
 * @param pageOfSlot - The pass's page table.
 * @param slot - The slot.
 * @returns Its page.
 */
function pageOf(pageOfSlot: Int32Array, slot: number): number {
  return pageOfSlot[slot] ?? 0;
}

/**
 * Where the span starting at a live slot ends: past the slots that go on with the next records
 * of the same object on the same page.
 *
 * @param pass - The pass.
 * @param start - The span's first slot, which has an owner.
 * @param end - The end of the visible range it is in.
 * @returns The slot after the span's last.
 */
function spanEnd(pass: PlannedPass, start: number, end: number): number {
  const { rankOfSlot, recordOfSlot } = pass.owners;
  const { pageOfSlot } = pass;
  const owner = tableEntry(rankOfSlot, start);
  const firstRecord = tableEntry(recordOfSlot, start);
  const page = pageOfSlot === undefined ? 0 : pageOf(pageOfSlot, start);
  let slot = start + 1;
  while (
    slot < end &&
    tableEntry(rankOfSlot, slot) === owner &&
    tableEntry(recordOfSlot, slot) === firstRecord + slot - start &&
    (pageOfSlot === undefined || pageOf(pageOfSlot, slot) === page)
  ) {
    slot += 1;
  }
  return slot;
}

/**
 * Gathers every pass's visible live records as spans (`PassSpans`), leaving out free slots and
 * the records of objects a pass hides at this level of detail, and marks which passes draw each
 * visible rank. O(visible slots) of plain table reads; everything else is per span.
 *
 * @param passes - The passes, in registered order.
 * @param visible - The culler's visible ranges.
 * @param rankOffset - The first paint rank of the window.
 * @param rankCount - How many paint ranks the window holds.
 * @returns The spans, pass masks, visible ranks and page spans.
 * @throws {RangeError} When a visible entry names no pass, or a visible slot's owner is outside
 *   the rank window.
 */
export function collectVisibleSpans(
  passes: readonly PlannedPass[],
  visible: readonly DrawListEntry[],
  rankOffset: number,
  rankCount: number,
): VisibleSpans {
  const spans = passes.map((pass, passIndex) => ({ pass, passIndex, starts: [], ends: [] }));
  const byName = new Map<string, PassSpans>(spans.map((entry) => [entry.pass.name, entry]));
  const passMaskByRank = new Int32Array(rankCount);
  const ranks: number[] = [];
  for (const { passName, ranges } of visible) {
    const target = byName.get(passName);
    if (!target) throw new RangeError(`The draw list names no scene pass "${passName}".`);
    const { rankOfSlot } = target.pass.owners;
    const hiddenRanks = target.pass.isHiddenByRank;
    const bit = 1 << target.passIndex;
    for (const { start, count } of ranges) {
      const end = Math.min(start + count, rankOfSlot.length);
      let slot = start;
      while (slot < end) {
        const owner = tableEntry(rankOfSlot, slot);
        if (owner < 0) {
          slot += 1;
          continue;
        }
        const rank = owner - rankOffset;
        if (rank < 0 || rank >= rankCount) {
          throw new RangeError(`Visible slot ${String(slot)} is outside the rank window.`);
        }
        const next = spanEnd(target.pass, slot, end);
        if (hiddenRanks?.[owner] !== 1) {
          target.starts.push(slot);
          target.ends.push(next);
          if (passMaskByRank[rank] === 0) ranks.push(rank);
          passMaskByRank[rank] = tableEntry(passMaskByRank, rank) | bit;
        }
        slot = next;
      }
    }
  }
  return {
    spans,
    passMaskByRank,
    sortedRanks: Int32Array.from(ranks).sort(),
    pageSpans: collectPageSpans(spans, rankCount, rankOffset),
  };
}

/**
 * The pages each visible object uses in each paged pass, for the segments' checks: a fall in
 * a pass that keeps paint order across pages starts a split, and in any paged pass a merge by
 * boxes must not draw a record under one it paints over. A span is on one page.
 *
 * @param spans - Every pass's visible spans.
 * @param rankCount - How many paint ranks there are.
 * @param rankOffset - The first global paint rank in the local tables.
 * @returns One entry per paged pass with visible records.
 */
function collectPageSpans(
  spans: readonly PassSpans[],
  rankCount: number,
  rankOffset: number,
): PassPageSpans[] {
  const pageSpans: PassPageSpans[] = [];
  for (const { pass, passIndex, starts } of spans) {
    const { pageOfSlot } = pass;
    if (pageOfSlot === undefined) continue;
    if (starts.length === 0) continue;
    const minPageByRank = new Int32Array(rankCount).fill(2 ** 31 - 1);
    const maxPageByRank = new Int32Array(rankCount).fill(-1);
    for (const slot of starts) {
      const rank = tableEntry(pass.owners.rankOfSlot, slot) - rankOffset;
      const page = pageOf(pageOfSlot, slot);
      minPageByRank[rank] = Math.min(tableEntry(minPageByRank, rank), page);
      maxPageByRank[rank] = Math.max(tableEntry(maxPageByRank, rank), page);
    }
    pageSpans.push({
      passIndex,
      isPaintOrdered: pass.isPaintOrderedAcrossPages === true,
      minPageByRank,
      maxPageByRank,
    });
  }
  return pageSpans;
}
