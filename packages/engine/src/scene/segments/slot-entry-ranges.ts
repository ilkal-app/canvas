import { SparseRanges } from '../../spatial/sparse-ranges.js';
import type { InstanceRange } from '../scene-culler.js';

interface OwnedRange extends InstanceRange {
  readonly entry: number;
}

/** Immutable first-owner intervals plus sparse departures, avoiding one map entry per live slot. */
export class SlotEntryRanges {
  private readonly covered = new SparseRanges();
  private readonly ranges: OwnedRange[] = [];
  private readonly removed = new Set<number>();

  /**
   * Assigns previously unowned slots while constructing the index.
   *
   * @param range - The entry's slots.
   * @param entry - Its stable index in the removal table.
   * @returns Newly owned intervals; prior assignments win on overlap.
   */
  add(range: InstanceRange, entry: number): readonly InstanceRange[] {
    const added = this.covered.add(range);
    for (const next of added) this.ranges.push({ ...next, entry });
    return added;
  }

  /** Finishes construction before any lookup or departure. */
  prepare(): void {
    this.ranges.sort((a, b) => a.start - b.start);
  }

  /**
   * Reads a still-live slot's first owning entry.
   *
   * @param slot - A GPU record slot.
   * @returns Its entry index, or undefined for a hole or departure.
   */
  get(slot: number): number | undefined {
    if (this.removed.has(slot)) return undefined;
    let low = 0;
    let high = this.ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const range = this.ranges[middle];
      if (!range) return undefined;
      if (slot < range.start) high = middle;
      else if (slot >= range.start + range.count) low = middle + 1;
      else return range.entry;
    }
    return undefined;
  }

  /**
   * Tests live coverage while repairing a changed object's page extrema.
   *
   * @param slot - A GPU record slot.
   * @returns Whether the slot has an owner and has not departed.
   */
  has(slot: number): boolean {
    return this.get(slot) !== undefined;
  }

  /**
   * Records a departure; construction has already finished.
   *
   * @param slot - The departed GPU record slot.
   */
  delete(slot: number): void {
    this.removed.add(slot);
  }
}
