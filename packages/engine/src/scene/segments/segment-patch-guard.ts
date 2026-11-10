import type { CullRangeChange } from '../scene-culler.js';

import type { PlannedPass } from './segment-plan.js';

/** A pending delta's changed slots that a patch would route: owned, and not hidden. */
export interface EligibleChanges {
  /** Eligible entering slots, over every pass. */
  readonly added: number;
  /** Eligible departing slots, over every pass. */
  readonly removed: number;
}

/** What a patch does before building its interval graph: go on, or refuse for a full plan. */
export type GraphVerdict = 'patch' | 'wide' | 'cost';

/**
 * Counts the slots of a pending delta that `SegmentWindows.route` would route, without routing.
 *
 * @param passes - The planned passes, with slot owners and hidden ranks.
 * @param pending - Each changed pass's delta, by name.
 * @returns Eligible added and removed slot counts.
 */
export function eligibleChanges(
  passes: readonly PlannedPass[],
  pending: ReadonlyMap<string, CullRangeChange>,
): EligibleChanges {
  let added = 0;
  let removed = 0;
  for (const pass of passes) {
    const change = pending.get(pass.name);
    if (!change) continue;
    const { rankOfSlot } = pass.owners;
    const hidden = pass.isHiddenByRank;
    for (const kind of ['added', 'removed'] as const) {
      let count = 0;
      for (const { start, count: length } of change[kind]) {
        const end = Math.min(start + length, rankOfSlot.length);
        for (let slot = start; slot < end; slot += 1) {
          const rank = rankOfSlot[slot] ?? -1;
          if (rank >= 0 && hidden?.[rank] !== 1) count += 1;
        }
      }
      if (kind === 'added') added += count;
      else removed += count;
    }
  }
  return { added, removed };
}

/**
 * Whether a first patch after a full plan is worth its whole-board interval graph.
 * The graph costs about as much as a full plan, so a delta that changes a quarter of the live
 * records is planned in full instead; an entering half is refused as `wide`, as after routing.
 *
 * @param changes - The delta's eligible slots.
 * @param live - Live records in the plan.
 * @returns `patch` to build the graph, else the refusal's kind.
 */
export function verdictBeforeGraph(changes: EligibleChanges, live: number): GraphVerdict {
  if (changes.added > 0 && (live === 0 || changes.added >= live / 2)) return 'wide';
  const changed = changes.added + changes.removed;
  if (changed > 0 && changed >= live / 4) return 'cost';
  return 'patch';
}
