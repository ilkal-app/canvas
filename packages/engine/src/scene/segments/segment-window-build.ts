import type { DrawListEntry } from '../draw-list.js';

import type { SegmentPlan, SegmentPlanInput } from './segment-plan.js';
import { SegmentWindow } from './segment-window.js';

/**
 * Partitions a pure plan into complete rank intervals. Each window's local tables are cut from
 * the plan only when first read (`SegmentWindow.plan`), so a patch pays only for the
 * windows it touches; the plan's tables must stay unchanged in a window's ranks until then.
 *
 * @param plan - A pure plan whose rank zero is `from` in the global domain.
 * @param input - Stable full-domain input.
 * @param from - First global rank covered by the plan.
 * @param to - Exclusive end of its global rank domain.
 * @param allocateId - Supplies unique live segment identities.
 * @param slotsOfRank - Global-rank record lookup.
 * @param onBuild - Called when a window's local tables are cut.
 * @returns Ordered disjoint intervals covering the input domain, including invisible ranks.
 */
export function buildWindows(
  plan: SegmentPlan,
  input: SegmentPlanInput,
  from: number,
  to: number,
  allocateId: () => number,
  slotsOfRank: (rank: number, name: string) => readonly number[],
  onBuild: () => void = () => undefined,
): SegmentWindow[] {
  const starts: { rank: number; segment: number }[] = [];
  let previous = -1;
  const { passMaskByRank, segmentOfRank } = plan;
  for (let rank = 0; rank < passMaskByRank.length; rank += 1) {
    if (passMaskByRank[rank] === 0) continue;
    const segment = segmentOfRank[rank] ?? -1;
    if (segment !== previous) starts.push({ rank: starts.length ? rank + from : from, segment });
    previous = segment;
  }
  if (!starts.length) starts.push({ rank: from, segment: -1 });
  const entries = groupedEntries(plan, input, from);
  return starts.map(({ rank, segment }, index) => {
    const end = starts[index + 1]?.rank ?? to;
    const local = { entries: entries.get(segment) ?? [], segmentCount: segment < 0 ? 0 : 1 };
    const cut = {
      ...local,
      hasSpatialMerges: plan.hasSpatialMerges,
      build: () => {
        onBuild();
        return localPlan(plan, rank - from, end - from, local);
      },
    };
    return new SegmentWindow(rank, end, allocateId(), cut, input, slotsOfRank);
  });
}

/**
 * One window's local tables, cut from the plan it is part of.
 *
 * @param plan - The plan.
 * @param startAt - The window's first rank, local to the plan.
 * @param endAt - Its exclusive end.
 * @param local - Its draws and segment count.
 * @param local.entries - Its draws.
 * @param local.segmentCount - 1 for a drawn segment, else 0.
 * @returns The local plan.
 */
function localPlan(
  plan: SegmentPlan,
  startAt: number,
  endAt: number,
  { entries, segmentCount }: { readonly entries: DrawListEntry[]; readonly segmentCount: number },
): SegmentPlan {
  return {
    entries,
    segmentCount,
    passMaskByRank: plan.passMaskByRank.slice(startAt, endAt),
    segmentOfRank: new Int32Array(endAt - startAt),
    splitOfRank: plan.splitOfRank.slice(startAt, endAt),
    hasSpatialMerges: plan.hasSpatialMerges,
    pageSpans: plan.pageSpans.map((span) => ({
      ...span,
      minPageByRank: span.minPageByRank.slice(startAt, endAt),
      maxPageByRank: span.maxPageByRank.slice(startAt, endAt),
    })),
  };
}

function groupedEntries(
  plan: SegmentPlan,
  input: SegmentPlanInput,
  offset: number,
): Map<number, DrawListEntry[]> {
  const result = new Map<number, DrawListEntry[]>();
  const passes = new Map(input.passes.map((pass) => [pass.name, pass]));
  for (const entry of plan.entries) {
    const owners = passes.get(entry.passName)?.owners.rankOfSlot;
    let rank = -1;
    for (const { start, count } of entry.ranges) {
      for (let slot = start; slot < start + count && rank < 0; slot += 1)
        rank = owners?.[slot] ?? -1;
      if (rank >= 0) break;
    }
    if (rank < 0) continue;
    const segment = plan.segmentOfRank[rank - offset] ?? -1;
    const list = result.get(segment) ?? [];
    list.push(entry);
    result.set(segment, list);
  }
  return result;
}

/**
 * Copies only one changed interval into privately owned global move-check tables.
 *
 * @param target - Global metadata, never emitted as GPU draw output.
 * @param window - The current local interval.
 */
export function copyWindowMetadata(target: SegmentPlan, window: SegmentWindow): void {
  const { from, to, plan } = window;
  target.passMaskByRank.set(plan.passMaskByRank, from);
  target.segmentOfRank.fill(window.id, from, to);
  target.splitOfRank.set(plan.splitOfRank, from);
  for (const span of target.pageSpans) {
    const local = plan.pageSpans.find(({ passIndex }) => passIndex === span.passIndex);
    span.minPageByRank.fill(2 ** 31 - 1, from, to);
    span.maxPageByRank.fill(-1, from, to);
    if (local) {
      span.minPageByRank.set(local.minPageByRank, from);
      span.maxPageByRank.set(local.maxPageByRank, from);
    }
  }
}
