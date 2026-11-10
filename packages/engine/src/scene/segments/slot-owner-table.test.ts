// The slot-owner table's noting: an object noted before a change set reaches the scene
// is patched in every pass it holds records in, before or after, and costs nothing in the others.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Scene } from '../scene.js';

import type { PlannedPass } from './segment-plan.js';
import { SlotOwnerTable } from './slot-owner-table.js';

const A = 'a' as ObjectId;
const B = 'b' as ObjectId;

/**
 * A two-pass scene whose slots a test sets.
 *
 * @returns The scene and its slots by pass, then object.
 */
function testScene() {
  const slots = new Map<string, Map<ObjectId, readonly number[]>>([
    ['shape', new Map()],
    ['text', new Map()],
  ]);
  const scene = {
    passes: [{ name: 'shape' }, { name: 'text' }],
    slotsOf: (id: ObjectId, name: string) => slots.get(name)?.get(id) ?? [],
    instanceBufferOf: () => ({ recordCount: 4, capacity: 4 }),
  } as unknown as Scene;
  return { scene, slots };
}

/**
 * An empty table for a pass, four slots long.
 *
 * @param name - The pass.
 * @returns The table.
 */
function emptyPass(name: string): PlannedPass {
  return {
    name,
    owners: { rankOfSlot: new Int32Array(4).fill(-1), recordOfSlot: new Int32Array(4) },
  };
}

/**
 * A table's owning rank per slot.
 *
 * @param table - The tables.
 * @param name - The pass.
 * @returns The ranks.
 */
function ranksOf(table: SlotOwnerTable, name: string): number[] {
  return [...(table.tables.find((pass) => pass.name === name)?.owners.rankOfSlot ?? [])];
}

describe('SlotOwnerTable', () => {
  it('patches an object in the passes it held or holds records in, and keeps the others', () => {
    const { scene, slots } = testScene();
    const table = new SlotOwnerTable();
    table.tables = [emptyPass('shape'), emptyPass('text')];
    slots.get('shape')?.set(A, [0, 1]);
    table.tables[0]?.owners.rankOfSlot.set([0, 0]);
    const text = table.tables[1];
    // `a` moves its records from slots 0–1 to 2; `b` is new, with a slot in the shape pass.
    table.noteChanged(scene, [A, B]);
    slots.get('shape')?.set(A, [2]);
    slots.get('shape')?.set(B, [3]);
    const ranks = new Map([
      [A, 0],
      [B, 1],
    ]);
    table.patch(scene, ranks, new Map());
    expect(ranksOf(table, 'shape')).toEqual([-1, -1, 0, 1]);
    expect(table.tables[1]).toBe(text);
    expect(table.patches).toBe(1);
  });

  it('keeps the slots an object held when first noted, however often it is noted again', () => {
    const { scene, slots } = testScene();
    const table = new SlotOwnerTable();
    table.tables = [emptyPass('shape'), emptyPass('text')];
    slots.get('text')?.set(A, [1]);
    table.tables[1]?.owners.rankOfSlot.set([-1, 0]);
    table.noteChanged(scene, [A]);
    slots.get('text')?.set(A, [2]);
    table.noteChanged(scene, [A]);
    slots.get('text')?.set(A, [3]);
    table.patch(scene, new Map([[A, 0]]), new Map());
    expect(ranksOf(table, 'text')).toEqual([-1, -1, -1, 0]);
  });

  it('forgets what it noted once patched', () => {
    const { scene, slots } = testScene();
    const table = new SlotOwnerTable();
    table.tables = [emptyPass('shape'), emptyPass('text')];
    slots.get('shape')?.set(A, [0]);
    table.noteChanged(scene, [A]);
    table.patch(scene, new Map([[A, 0]]), new Map());
    const patched = table.tables;
    table.patch(scene, new Map([[A, 0]]), new Map());
    expect(table.tables[0]).toBe(patched[0]);
    expect(table.tables[1]).toBe(patched[1]);
  });
});
