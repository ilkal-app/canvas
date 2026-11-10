import { describe, expect, it } from 'vitest';

import { ShelfAllocator } from './shelf-allocator.js';

describe('ShelfAllocator', () => {
  // Ported from the prototype's `src/atlas/shelfPacker.test.ts`; a shorter item reuses a shelf
  // only when the shelf fits it snugly (at most 1.25× its height).
  it('packs left to right on a shelf, then opens new shelves', () => {
    const shelves = new ShelfAllocator(100, 100);
    expect(shelves.allocate(30, 10)).toMatchObject({ x: 0, y: 0 });
    expect(shelves.allocate(30, 10)).toMatchObject({ x: 30, y: 0 });
    expect(shelves.allocate(50, 10)).toMatchObject({ x: 0, y: 10 });
    expect(shelves.allocate(30, 9)).toMatchObject({ x: 60, y: 0, height: 10 });
    expect(shelves.allocate(30, 5)).toMatchObject({ x: 0, y: 20, height: 5 });
  });

  it('returns undefined when nothing fits', () => {
    const shelves = new ShelfAllocator(100, 100);
    expect(shelves.allocate(10, 200)).toBeUndefined();
    expect(shelves.allocate(200, 10)).toBeUndefined();
    expect(shelves.allocate(100, 60)).toMatchObject({ x: 0, y: 0 });
    expect(shelves.allocate(100, 50)).toBeUndefined();
  });

  it('prefers the shortest shelf that fits, so small glyphs do not waste tall shelves', () => {
    const shelves = new ShelfAllocator(100, 100);
    shelves.allocate(10, 40);
    shelves.allocate(10, 10);
    expect(shelves.allocate(10, 8)).toMatchObject({ x: 10, y: 40 });
  });

  it('falls back to a taller shelf once the page has no room for a new one', () => {
    const shelves = new ShelfAllocator(100, 50);
    shelves.allocate(10, 40);
    expect(shelves.allocate(10, 20)).toMatchObject({ x: 10, y: 0, height: 40 });
  });

  it('reuses a freed span for a narrower item and merges neighbouring free spans', () => {
    const shelves = new ShelfAllocator(100, 100);
    const a = shelves.allocate(30, 10);
    const b = shelves.allocate(30, 10);
    shelves.allocate(40, 10);
    if (a === undefined || b === undefined) throw new Error('allocation failed');
    shelves.free(a);
    expect(shelves.allocate(20, 10)).toMatchObject({ x: 0, y: 0 });
    shelves.free(b);
    // The free 10 left of b and b's 30 merge into one 40-wide span.
    expect(shelves.allocate(40, 10)).toMatchObject({ x: 20, y: 0 });
  });

  it('gives back trailing empty shelves, so a taller item can use the space', () => {
    const shelves = new ShelfAllocator(100, 100);
    shelves.allocate(100, 50);
    const low = shelves.allocate(10, 30);
    if (low === undefined) throw new Error('allocation failed');
    expect(shelves.allocate(10, 40)).toBeUndefined();
    shelves.free(low);
    expect(shelves.allocate(10, 40)).toMatchObject({ x: 0, y: 50 });
    expect(shelves.isEmpty).toBe(false);
  });

  it('reports when every allocation has been freed', () => {
    const shelves = new ShelfAllocator(64, 64);
    const first = shelves.allocate(8, 8);
    const second = shelves.allocate(8, 16);
    expect(shelves.isEmpty).toBe(false);
    if (first === undefined || second === undefined) throw new Error('allocation failed');
    shelves.free(second);
    shelves.free(first);
    expect(shelves.isEmpty).toBe(true);
    expect(shelves.allocate(64, 64)).toMatchObject({ x: 0, y: 0 });
  });

  it('ignores freeing an allocation twice', () => {
    const shelves = new ShelfAllocator(64, 64);
    const first = shelves.allocate(8, 8);
    shelves.allocate(8, 8);
    if (first === undefined) throw new Error('allocation failed');
    shelves.free(first);
    shelves.free(first);
    expect(shelves.allocate(8, 8)).toMatchObject({ x: 0, y: 0 });
    expect(shelves.allocate(8, 8)).toMatchObject({ x: 16, y: 0 });
  });
});
