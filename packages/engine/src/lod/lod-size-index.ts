/** An object in a size index: anything with a size. */
export interface SizedEntry {
  /** Its size, world units; NaN while it is in no bucket. */
  size: number;
}

/** Empty buckets kept before a compaction is considered (a bucket emptied by a drag is reused). */
const MIN_EMPTY_BEFORE_COMPACTION = 64;

/**
 * A pass's level-of-detail entries by size (fix round 1): a bucket per distinct size and
 * the sizes sorted, so a zoom from one scale to another finds by binary search the sizes whose
 * size on screen crossed an edge of the rule (`lodEdgesOf`), O(passes × edges × log sizes) when
 * nothing crosses, whatever the spread of sizes (freehand strokes, images: thousands of distinct
 * values). A new size is appended and the sizes sorted again before the next search (nearly
 * sorted, so the sort is about linear); an emptied bucket is kept, and so reused by a size that
 * comes back (a drag), until they are more than half the buckets. CPU-only; the frame's thread.
 */
export class LodSizeIndex<Entry extends SizedEntry> {
  private readonly buckets = new Map<number, Set<Entry>>();
  private readonly sizes: number[] = [];
  private isSorted = true;
  private emptyCount = 0;

  /**
   * How many distinct sizes are indexed, empty buckets included.
   *
   * @returns The count.
   */
  get sizeCount(): number {
    return this.sizes.length;
  }

  /**
   * Puts an entry in the bucket of a size, out of its previous one.
   *
   * @param entry - The entry; its `size` is set.
   * @param size - Its size, world units, finite.
   */
  place(entry: Entry, size: number): void {
    this.remove(entry);
    entry.size = size;
    let bucket = this.buckets.get(size);
    if (bucket === undefined) {
      bucket = new Set();
      this.buckets.set(size, bucket);
      const last = this.sizes[this.sizes.length - 1];
      if (last !== undefined && size < last) this.isSorted = false;
      this.sizes.push(size);
    } else if (bucket.size === 0) {
      this.emptyCount -= 1;
    }
    bucket.add(entry);
  }

  /**
   * Takes an entry out of its bucket.
   *
   * @param entry - The entry.
   */
  remove(entry: Entry): void {
    const bucket = this.buckets.get(entry.size);
    if (bucket?.delete(entry) !== true) return;
    if (bucket.size === 0) this.emptyCount += 1;
  }

  /**
   * Sorts the sizes (and drops empty buckets when they are most of them); call before
   * {@link firstAtLeast} and {@link bucketAt} after a change.
   */
  prepare(): void {
    if (this.emptyCount > MIN_EMPTY_BEFORE_COMPACTION && this.emptyCount * 2 > this.sizes.length) {
      this.compact();
    }
    if (this.isSorted) return;
    this.sizes.sort((a, b) => a - b);
    this.isSorted = true;
  }

  /**
   * The index of the first size whose size on screen at a scale is at least an edge: sizes from
   * there on are on or above the edge, those before it under it. Needs {@link prepare}.
   *
   * @param edgePx - The edge, device pixels.
   * @param scale - Device pixels per world unit, positive.
   * @returns An index into the sorted sizes, from 0 to their count.
   */
  firstAtLeast(edgePx: number, scale: number): number {
    const { sizes } = this;
    let low = 0;
    let high = sizes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((sizes[middle] ?? 0) * scale >= edgePx) high = middle;
      else low = middle + 1;
    }
    return low;
  }

  /**
   * The entries of the size at a sorted index. Needs {@link prepare}.
   *
   * @param index - An index into the sorted sizes.
   * @returns Its bucket, possibly empty.
   */
  bucketAt(index: number): ReadonlySet<Entry> | undefined {
    const size = this.sizes[index];
    return size === undefined ? undefined : this.buckets.get(size);
  }

  private compact(): void {
    let kept = 0;
    for (const size of this.sizes) {
      if (this.buckets.get(size)?.size === 0) this.buckets.delete(size);
      else this.sizes[kept++] = size;
    }
    this.sizes.length = kept;
    this.emptyCount = 0;
  }
}
