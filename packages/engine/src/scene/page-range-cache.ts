import { PagePartition } from './page-partition.js';
import { splitRangesByPage, type PageRanges } from './page-split.js';
import type { CullRangeChange, InstanceRange } from './scene-culler.js';
import type { Scene } from './scene.js';

interface CachedPartition {
  readonly revision: number;
  readonly pages: Int32Array;
  readonly ranges: readonly InstanceRange[];
  readonly partition: PagePartition;
  change: CullRangeChange | undefined;
}

/**
 * Keeps one page partition per pass of the current scene. Camera-only frames compare ranges,
 * not every record's page. Range snapshots also support custom cullers that mutate and reuse
 * their arrays; a page revision invalidates asynchronous page changes without a cull change.
 */
export class PageRangeCache {
  private scene: Scene | undefined;
  private readonly passes = new Map<string, CachedPartition>();

  /**
   * Splits ranges only when their contents or the pass's page table changed.
   *
   * @param scene - The current scene; changing it clears every cached pass.
   * @param passName - The paged pass.
   * @param ranges - Its culled ranges; may be reused and mutated by a custom culler.
   * @param pages - Its current page table.
   * @param change - Optional precise drawn-slot delta from an incremental culler.
   * @returns The page partition, reused unchanged when the inputs are equivalent.
   */
  split(
    scene: Scene,
    passName: string,
    ranges: readonly InstanceRange[],
    pages: Int32Array,
    change?: CullRangeChange,
  ): readonly PageRanges[] {
    if (scene !== this.scene) {
      this.passes.clear();
      this.scene = scene;
    }
    const revision = scene.pageRevisionOf(passName);
    const cached = this.passes.get(passName);
    const isSameTable = cached?.revision === revision && cached.pages === pages;
    if (isSameTable && sameRanges(cached.ranges, ranges)) {
      cached.change = change;
      return cached.partition.value;
    }
    const isConsecutive =
      isSameTable &&
      change !== undefined &&
      cached.change?.source === change.source &&
      cached.change.revision === change.previousRevision;
    const partition = isConsecutive
      ? cached.partition
      : new PagePartition(splitRangesByPage(ranges, pages));
    if (isConsecutive) partition.patch(change, pages);
    this.passes.set(passName, {
      revision,
      pages,
      ranges: ranges.map(({ start, count }) => ({ start, count })),
      partition,
      change,
    });
    return partition.value;
  }
}

/**
 * Compares range values against the independent cached snapshot.
 *
 * @param snapshot - The previous values.
 * @param ranges - This frame's ranges.
 * @returns Whether every range has the same start and count.
 */
function sameRanges(snapshot: readonly InstanceRange[], ranges: readonly InstanceRange[]): boolean {
  return (
    snapshot.length === ranges.length &&
    snapshot.every((range, index) => {
      const current = ranges[index];
      return current?.start === range.start && current.count === range.count;
    })
  );
}
