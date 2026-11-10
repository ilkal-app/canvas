import { describe, expect, it } from 'vitest';

import { LodSizeIndex, type SizedEntry } from './lod-size-index.js';

const entry = (): SizedEntry => ({ size: Number.NaN });

/**
 * The sizes of the index's buckets in sorted order, empty ones left out.
 *
 * @param index - The index, prepared.
 * @returns The sizes with entries.
 */
function sizesOf(index: LodSizeIndex<SizedEntry>): number[] {
  const sizes: number[] = [];
  for (let at = 0; at < index.sizeCount; at += 1) {
    const [first] = index.bucketAt(at) ?? [];
    if (first !== undefined) sizes.push(first.size);
  }
  return sizes;
}

describe('LodSizeIndex', () => {
  it('keeps one bucket per size, sorted once prepared', () => {
    const index = new LodSizeIndex<SizedEntry>();
    const [a, b, c] = [entry(), entry(), entry()];
    index.place(a, 30);
    index.place(b, 10);
    index.place(c, 30);
    index.prepare();
    expect(index.sizeCount).toBe(2);
    expect(sizesOf(index)).toEqual([10, 30]);
    expect(index.bucketAt(1)?.size).toBe(2);
    expect(index.bucketAt(2)).toBeUndefined();
  });

  it('finds the first size at or above an edge at a scale', () => {
    const index = new LodSizeIndex<SizedEntry>();
    for (const size of [5, 10, 20, 40]) index.place(entry(), size);
    index.prepare();
    // At 0.2 px per unit: 1, 2, 4, 8 px.
    expect(index.firstAtLeast(4, 0.2)).toBe(2);
    expect(index.firstAtLeast(4.1, 0.2)).toBe(3);
    expect(index.firstAtLeast(0.5, 0.2)).toBe(0);
    expect(index.firstAtLeast(100, 0.2)).toBe(4);
  });

  it('moves an entry between buckets and reuses an emptied bucket', () => {
    const index = new LodSizeIndex<SizedEntry>();
    const moving = entry();
    index.place(moving, 10);
    index.place(moving, 20);
    index.place(moving, 10);
    index.prepare();
    expect(index.sizeCount).toBe(2);
    expect(sizesOf(index)).toEqual([10]);
    index.remove(moving);
    expect(sizesOf(index)).toEqual([]);
  });

  it('drops empty buckets once they are most of them', () => {
    const index = new LodSizeIndex<SizedEntry>();
    const entries = Array.from({ length: 200 }, (unused, at) => {
      const created = entry();
      index.place(created, 200 - at);
      return created;
    });
    for (const removed of entries.slice(0, 150)) index.remove(removed);
    index.prepare();
    expect(index.sizeCount).toBe(50);
    expect(sizesOf(index)).toEqual(Array.from({ length: 50 }, (unused, at) => at + 1));
  });
});
