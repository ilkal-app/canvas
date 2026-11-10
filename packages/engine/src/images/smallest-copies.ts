import type { AssetId } from '@canvas/schema';

import type { DecodedLevel } from '../workers/job-kinds.js';

import type { CatalogueEntry } from './asset-catalogue.js';

/** Bounded smallest-level copies, unused first then LRU within each reference class. */
export class SmallestCopies {
  private readonly entries = new Map<AssetId, CatalogueEntry>();
  private bytes = 0;

  /**
   * Creates an empty cache owned by one catalogue.
   *
   * @param maxBytes - Existing shared CPU-copy cap, bytes.
   * @param isUsed - Whether an image still references the asset.
   */
  constructor(
    private readonly maxBytes: number,
    private readonly isUsed: (id: AssetId) => boolean,
  ) {}

  /**
   * Reads retained metadata without changing its recency.
   *
   * @param id - The asset.
   * @returns Its retained entry, if any.
   */
  get(id: AssetId): CatalogueEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * All retained entries, including unused ones.
   *
   * @returns Entries in oldest-first order.
   */
  values(): Iterable<CatalogueEntry> {
    return this.entries.values();
  }

  /**
   * Touches a restored or read copy, replacing retired entry identity without adding bytes.
   *
   * @param entry - The current entry sharing the retained pixels.
   */
  touch(entry: CatalogueEntry): void {
    if (entry.smallest === undefined) return;
    this.entries.delete(entry.assetId);
    this.entries.set(entry.assetId, entry);
  }

  /**
   * Retains pixels under the shared cap. An active newest copy keeps the existing single-copy
   * exception if it alone exceeds the cap; unused copies never evict referenced copies.
   *
   * @param entry - The current asset.
   * @param level - Its smallest pixels.
   */
  keep(entry: CatalogueEntry, level: DecodedLevel): void {
    this.drop(entry);
    entry.smallest = level;
    entry.hasBeenReady = true;
    this.entries.set(entry.assetId, entry);
    this.bytes += level.rgba.byteLength;
    for (const oldest of this.entries.values()) {
      if (this.bytes <= this.maxBytes) break;
      if (!this.isUsed(oldest.assetId)) this.drop(oldest);
    }
    if (!this.entries.has(entry.assetId)) return;
    for (const oldest of this.entries.values()) {
      if (this.bytes <= this.maxBytes || oldest === entry) break;
      this.drop(oldest);
    }
  }

  /**
   * Frees an entry's pixels and accounting, preserving its historical readiness.
   *
   * @param entry - The entry.
   */
  drop(entry: CatalogueEntry): void {
    if (entry.smallest === undefined) return;
    this.bytes -= entry.smallest.rgba.byteLength;
    entry.smallest = undefined;
    this.entries.delete(entry.assetId);
  }

  /** Frees every retained copy. */
  clear(): void {
    for (const entry of this.entries.values()) this.drop(entry);
  }
}
