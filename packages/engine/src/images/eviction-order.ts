/** A resident image level (or atlas entry) as the eviction policy sees it. */
export interface EvictionCandidate {
  /** Identifies the level to its owner. */
  readonly key: string;
  /** The GPU bytes evicting it frees. */
  readonly bytes: number;
  /** The last frame that drew or needed it. */
  readonly lastUsedFrame: number;
  /**
   * Whether the current viewport needs it: the smallest level of a visible image, the level a
   * visible image shows or is about to show. Needed levels are never evicted.
   */
  readonly isNeeded: boolean;
}

/** What {@link planEvictions} decided. */
export interface EvictionPlan {
  /** The keys to evict, in order. */
  readonly evict: readonly string[];
  /** Whether the new level fits once they are gone; when false, nothing should be evicted. */
  readonly canFit: boolean;
}

/**
 * The order the texture manager evicts in: only levels the viewport does
 * not need, the largest first (one of them frees what many small ones would), and among equal
 * sizes the least recently used. Pure; returns a new array.
 *
 * @param candidates - The resident levels.
 * @returns The evictable ones, first to go first.
 */
export function evictionOrder<T extends EvictionCandidate>(candidates: readonly T[]): T[] {
  return candidates
    .filter((candidate) => !candidate.isNeeded)
    .sort((a, b) => b.bytes - a.bytes || a.lastUsedFrame - b.lastUsedFrame);
}

/**
 * Which levels to evict so a new one of `incomingBytes` fits under the budget: the fewest from
 * the front of {@link evictionOrder}. When even evicting every idle level would not make room,
 * the plan evicts nothing and reports that the level does not fit, so the caller keeps what it
 * has rather than emptying the cache for nothing. Pure.
 *
 * @param candidates - The resident levels.
 * @param residentBytes - The bytes resident now.
 * @param budgetBytes - The cap.
 * @param incomingBytes - The size of the level to add.
 * @returns The keys to evict and whether the level then fits.
 */
export function planEvictions(
  candidates: readonly EvictionCandidate[],
  residentBytes: number,
  budgetBytes: number,
  incomingBytes: number,
): EvictionPlan {
  let excess = residentBytes + incomingBytes - budgetBytes;
  if (excess <= 0) return { evict: [], canFit: true };
  const evict: string[] = [];
  for (const candidate of evictionOrder(candidates)) {
    evict.push(candidate.key);
    excess -= candidate.bytes;
    if (excess <= 0) return { evict, canFit: true };
  }
  return { evict: [], canFit: false };
}
