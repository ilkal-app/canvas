import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ClipRect } from '../spatial/clip-chain.js';

import { CLIP_FLOATS_PER_SLOT, ClipTable } from './clip-table.js';

function rect(id: string, fields: Partial<ClipRect> = {}): ClipRect {
  return { id: id as ObjectId, x: 0, y: 0, cos: 1, sin: 0, width: 100, height: 50, ...fields };
}

function recordAt(table: ClipTable, slot: number): number[] {
  return Array.from(
    table.data.subarray(slot * CLIP_FLOATS_PER_SLOT, (slot + 1) * CLIP_FLOATS_PER_SLOT),
  );
}

describe('ClipTable', () => {
  it('reserves slot 0, all zeros, for unclipped records', () => {
    const table = new ClipTable();
    expect(table.set(rect('a', { x: 5, y: 6 }), undefined, 0)).toBe(1);
    expect(recordAt(table, 0)).toEqual(new Array(16).fill(0));
    expect(table.slotOf('a' as ObjectId)).toBe(1);
    expect(table.slotOf('missing' as ObjectId)).toBe(0);
  });

  it('writes origin and axis, size and parent slot, and no parent map for an outermost clip', () => {
    const table = new ClipTable();
    const slot = table.set(rect('a', { x: 5, y: 6, cos: 0, sin: 1 }), undefined, 0);
    expect(recordAt(table, slot)).toEqual([5, 6, 0, 1, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(table.dirtyTexels).toEqual([4, 8]);
  });

  it('maps a nested clip into its parent clip, in float64, rotation included', () => {
    const table = new ClipTable();
    // The parent turned a quarter clockwise at (100, 0); the child, turned with it, 10 down its
    // local x axis: world (100, 10).
    const parent = rect('p', { x: 100, y: 0, cos: 0, sin: 1 });
    const parentSlot = table.set(parent, undefined, 0);
    const child = rect('c', { x: 100, y: 10, cos: 0, sin: 1, width: 20, height: 30 });
    const slot = table.set(child, parent, parentSlot);
    expect(recordAt(table, slot)).toEqual([
      100,
      10,
      0,
      1,
      20,
      30,
      parentSlot,
      0,
      1,
      0,
      10,
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  it('stays clean when a record is written unchanged', () => {
    const table = new ClipTable();
    table.set(rect('a'), undefined, 0);
    table.clearDirty();
    table.set(rect('a'), undefined, 0);
    expect(table.dirtyTexels).toEqual([0, 0]);
    table.set(rect('a', { width: 101 }), undefined, 0);
    expect(table.dirtyTexels).toEqual([4, 8]);
  });

  it('zeroes a released slot and reuses it', () => {
    const table = new ClipTable();
    table.set(rect('a'), undefined, 0);
    table.set(rect('b'), undefined, 0);
    table.clearDirty();
    table.release('a' as ObjectId);
    expect(recordAt(table, 1)).toEqual(new Array(16).fill(0));
    expect(table.dirtyTexels).toEqual([4, 8]);
    expect(table.size).toBe(1);
    expect(table.set(rect('c'), undefined, 0)).toBe(1);
    table.release('missing' as ObjectId);
    expect(table.usedSlots).toBe(3);
  });

  it('writes a rounded clip flag and its four capped radii', () => {
    const table = new ClipTable();
    const slot = table.set(rect('r', { cornerRadius: [0, 10, 40, 5] }), undefined, 0);
    expect(recordAt(table, slot)).toEqual([0, 0, 1, 0, 100, 50, 0, 1, 0, 0, 0, 0, 0, 10, 25, 5]);
    const sharp = table.set(rect('s', { cornerRadius: 0 }), undefined, 0);
    expect(recordAt(table, sharp).slice(4)).toEqual([100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('doubles its capacity and keeps every record', () => {
    const table = new ClipTable();
    const initial = table.capacity;
    for (let index = 1; index <= initial; index++) {
      table.set(rect(`f${String(index)}`, { x: index }), undefined, 0);
    }
    expect(table.capacity).toBe(initial * 2);
    expect(table.usedSlots).toBe(initial + 1);
    for (let index = 1; index <= initial; index++) expect(recordAt(table, index)[0]).toBe(index);
  });
});
