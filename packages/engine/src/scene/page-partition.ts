import { SparseRanges } from '../spatial/sparse-ranges.js';

import { splitRangesByPage, type PageRanges } from './page-split.js';
import type { CullRangeChange } from './scene-culler.js';

/** Keeps page intervals while reading only newly drawn slots on a visibility patch. */
export class PagePartition {
  private readonly pages = new Map<number, SparseRanges>();
  private output: readonly PageRanges[];

  /**
   * Takes a complete page partition for initial load or a page-table reset.
   *
   * @param partition - The reference partition.
   */
  constructor(partition: readonly PageRanges[]) {
    this.output = partition;
    for (const { page, ranges } of partition) this.pages.set(page, new SparseRanges(ranges));
  }

  /**
   * Applies actual drawn-slot changes using the unchanged page table.
   *
   * @param change - A consecutive coverage change.
   * @param pageBySlot - The current table, unchanged since the previous partition.
   * @returns The updated page partition.
   */
  patch(change: CullRangeChange, pageBySlot: Int32Array): readonly PageRanges[] {
    for (const [page, ranges] of this.pages) {
      for (const removed of change.removed) ranges.remove(removed);
      if (ranges.values().length === 0) this.pages.delete(page);
    }
    for (const { page, ranges } of splitRangesByPage(change.added, pageBySlot)) {
      let target = this.pages.get(page);
      if (!target) {
        target = new SparseRanges();
        this.pages.set(page, target);
      }
      for (const range of ranges) target.add(range);
    }
    this.output = [...this.pages]
      .sort(([first], [second]) => first - second)
      .map(([page, ranges]) => ({ page, ranges: ranges.values() }));
    return this.output;
  }

  /**
   * Reads the current immutable partition.
   *
   * @returns One entry per page, pages ascending.
   */
  get value(): readonly PageRanges[] {
    return this.output;
  }
}
