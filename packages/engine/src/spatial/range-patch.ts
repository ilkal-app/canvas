import type { InstanceRange } from '../scene/scene-culler.js';

import { SparseRanges } from './sparse-ranges.js';

/** Final coverage changes relative to the previous frame, including bridged gaps. */
export interface RangePatch {
  readonly added: readonly InstanceRange[];
  readonly removed: readonly InstanceRange[];
}

/** Cancels opposite updates so a frame exposes only its net drawn-slot changes. */
export class RangePatchBuilder {
  private readonly added = new SparseRanges();
  private readonly removed = new SparseRanges();

  /**
   * Incorporates one actual coverage operation.
   *
   * @param ranges - The changed drawn intervals.
   * @param isAdded - Whether they became drawn.
   */
  record(ranges: readonly InstanceRange[], isAdded: boolean): void {
    const target = isAdded ? this.added : this.removed;
    const opposite = isAdded ? this.removed : this.added;
    for (const range of ranges) {
      const remaining = new SparseRanges([range]);
      for (const canceled of opposite.remove(range)) remaining.remove(canceled);
      for (const uncanceled of remaining.values()) target.add(uncanceled);
    }
  }

  /**
   * Reads the net patch.
   *
   * @returns Disjoint added and removed intervals.
   */
  value(): RangePatch {
    return { added: this.added.values(), removed: this.removed.values() };
  }
}
