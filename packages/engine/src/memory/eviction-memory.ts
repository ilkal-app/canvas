/**
 * How long an eviction is remembered, ms: the zoom sweep's length (the
 * benchmark's 8-second sweep), the span within which regenerating what was evicted is
 * thrash rather than ordinary cache turnover.
 */
export const REGENERATION_WINDOW_MS = 8_000;

/**
 * The keys a cache evicted in the last {@link REGENERATION_WINDOW_MS}, so it can count the
 * entries it makes again soon after evicting them (the glyph atlas and the path mesh cache:
 *'s no-thrash rule says a zoom sweep regenerates nothing it evicted). Evictions are kept
 * in time order and pruned from the oldest, so each costs O(1) amortised. CPU-only; the frame's
 * thread.
 */
export class EvictionMemory {
  /** Evicted keys and when, oldest first (a Map keeps insertion order). */
  private readonly evictedAt = new Map<string, number>();
  private count = 0;

  /**
   * Regenerations counted since this was created.
   *
   * @returns The count.
   */
  get regenerations(): number {
    return this.count;
  }

  /**
   * Evictions remembered now.
   *
   * @returns The count.
   */
  get size(): number {
    return this.evictedAt.size;
  }

  /**
   * Notes an eviction.
   *
   * @param key - The evicted entry's key.
   * @param timeMs - The frame's time, ms.
   */
  evicted(key: string, timeMs: number): void {
    this.evictedAt.delete(key);
    this.evictedAt.set(key, timeMs);
  }

  /**
   * Notes that an entry was made (inserted, built) and says whether it is a regeneration: the
   * same key was evicted within the window.
   *
   * @param key - The entry's key.
   * @param timeMs - The frame's time, ms.
   * @returns Whether it was a regeneration (then counted).
   */
  made(key: string, timeMs: number): boolean {
    const evictedAt = this.evictedAt.get(key);
    if (evictedAt === undefined) return false;
    this.evictedAt.delete(key);
    if (timeMs - evictedAt > REGENERATION_WINDOW_MS) return false;
    this.count += 1;
    return true;
  }

  /**
   * Forgets the evictions older than the window.
   *
   * @param timeMs - The frame's time, ms.
   */
  prune(timeMs: number): void {
    for (const [key, evictedAt] of this.evictedAt) {
      if (timeMs - evictedAt <= REGENERATION_WINDOW_MS) return;
      this.evictedAt.delete(key);
    }
  }
}
