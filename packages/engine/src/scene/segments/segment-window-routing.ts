import type { CullRangeChange } from '../scene-culler.js';

import type { PlannedPass } from './segment-plan.js';
import type { TouchedSlots } from './segment-touches.js';
import type { SegmentWindow, WindowDelta } from './segment-window.js';

interface RoutedRange {
  readonly start: number;
  count: number;
}

interface RoutedDelta {
  readonly added: RoutedRange[];
  readonly removed: RoutedRange[];
}

/** Each window's share of a delta, by pass. */
export type RoutedChanges = Map<SegmentWindow, Map<string, WindowDelta>>;

/**
 * Splits changed slots among the windows owning their ranks.
 *
 * @param pending - The delta, by pass.
 * @param windows - The windows, in rank order.
 * @param passes - The planned passes, for slot owners and hidden ranks.
 * @param onRead - Called once per slot read.
 * @returns The windows' shares; a window absent from it has none.
 * @throws {RangeError} When an owned rank has no window.
 */
export function routeChanges(
  pending: ReadonlyMap<string, CullRangeChange>,
  windows: readonly SegmentWindow[],
  passes: readonly PlannedPass[],
  onRead: () => void,
): RoutedChanges {
  const result = new Map<SegmentWindow, Map<string, RoutedDelta>>();
  for (const [name, change] of pending) {
    const pass = passes.find((candidate) => candidate.name === name);
    if (!pass) continue;
    for (const kind of ['added', 'removed'] as const) {
      let current: SegmentWindow | undefined;
      let ranges: RoutedRange[] | undefined;
      for (const { start, count } of change[kind]) {
        const end = Math.min(start + count, pass.owners.rankOfSlot.length);
        for (let slot = start; slot < end; slot += 1) {
          onRead();
          const rank = pass.owners.rankOfSlot[slot] ?? -1;
          // A hidden rank's slots never enter, but leave even if hidden since.
          if (rank < 0 || (kind === 'added' && pass.isHiddenByRank?.[rank] === 1)) continue;
          if (!current || rank < current.from || rank >= current.to) {
            current = windows[windowIndexOf(rank, windows)];
            if (!current) throw new RangeError('Owned rank has no segment interval.');
            ranges = deltaOf(result, current, name)[kind];
          }
          const last = ranges?.at(-1);
          if (last && last.start + last.count === slot) last.count += 1;
          else ranges?.push({ start: slot, count: 1 });
        }
      }
    }
  }
  return result;
}

/**
 * The windows to re-plan for records the level of detail hid: each one's window and
 * its neighbours, so segments the hidden record kept apart can merge. Each gains a share in
 * `routed`, empty if it had none.
 *
 * @param hidden - Per pass, the slots hidden since the last plan.
 * @param windows - The windows, in rank order.
 * @param passes - The planned passes, for slot owners.
 * @param routed - The windows' shares; extended in place.
 * @returns The windows to re-plan.
 */
export function mergingWindows(
  hidden: TouchedSlots,
  windows: readonly SegmentWindow[],
  passes: readonly PlannedPass[],
  routed: RoutedChanges,
): Set<SegmentWindow> {
  const merging = new Set<SegmentWindow>();
  for (const [name, slots] of hidden) {
    const owners = passes.find((pass) => pass.name === name)?.owners.rankOfSlot;
    for (const slot of slots) {
      const rank = owners?.[slot] ?? -1;
      if (rank < 0) continue;
      const index = windowIndexOf(rank, windows);
      for (const window of windows.slice(Math.max(0, index - 1), index + 2)) {
        merging.add(window);
        if (!routed.has(window)) routed.set(window, new Map());
      }
    }
  }
  return merging;
}

/**
 * The index of the window holding a rank.
 *
 * @param rank - A global paint rank.
 * @param windows - The windows, in rank order.
 * @returns Its index; `windows.length` past the last.
 */
function windowIndexOf(rank: number, windows: readonly SegmentWindow[]): number {
  let low = 0;
  let high = windows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const window = windows[middle];
    if (window && window.to <= rank) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A window's share of one pass's changes, made on first use.
 *
 * @param result - The shares so far.
 * @param window - The window.
 * @param name - The pass.
 * @returns The share.
 */
function deltaOf(
  result: Map<SegmentWindow, Map<string, RoutedDelta>>,
  window: SegmentWindow,
  name: string,
): RoutedDelta {
  let deltas = result.get(window);
  if (!deltas) {
    deltas = new Map<string, RoutedDelta>();
    result.set(window, deltas);
  }
  let delta = deltas.get(name);
  if (!delta) {
    delta = { added: [], removed: [] };
    deltas.set(name, delta);
  }
  return delta;
}
