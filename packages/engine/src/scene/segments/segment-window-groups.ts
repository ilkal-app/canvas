import type { SegmentWindow, WindowDelta } from './segment-window.js';

/** A contiguous collection of affected old intervals. */
export interface WindowGroup {
  /** Complete intervals, in global rank order. */
  readonly windows: SegmentWindow[];
  /** Their combined membership changes. */
  readonly deltas: Map<string, WindowDelta>;
}

/**
 * Coalesces adjacent affected intervals before planning; unchanged intervals remain boundaries.
 *
 * @param windows - All intervals, in rank order.
 * @param routed - Changes routed by interval ownership.
 * @returns Consecutive groups, some removal-only.
 */
export function windowGroups(
  windows: readonly SegmentWindow[],
  routed: ReadonlyMap<SegmentWindow, ReadonlyMap<string, WindowDelta>>,
): WindowGroup[] {
  const groups: WindowGroup[] = [];
  let current: WindowGroup | undefined;
  for (const window of windows) {
    const deltas = routed.get(window);
    if (!deltas) {
      current = undefined;
      continue;
    }
    if (!current) {
      current = { windows: [], deltas: new Map() };
      groups.push(current);
    }
    current.windows.push(window);
    for (const [name, delta] of deltas) {
      const merged = current.deltas.get(name) ?? { added: [], removed: [] };
      merged.added.push(...delta.added);
      merged.removed.push(...delta.removed);
      current.deltas.set(name, merged);
    }
  }
  return groups;
}
