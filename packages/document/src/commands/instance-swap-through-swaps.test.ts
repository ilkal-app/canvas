// Review, round 3: a swap may not close a cycle through another instance's swap. A
// main contains the instance when it holds an instance swapped to the instance's container.
import { describe, expect, it } from 'vitest';

import type { InstanceOverrides, ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand } from './__fixtures__/component-fixtures.js';
import { containingMains } from './containing-mains.js';
import { createInstanceCommand } from './create-instance.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';

/**
 * Mains `b` and `b-two` (leaves), `a` and `e` (each holding a slot of `b`: `slot`, `slot-e`),
 * and the empty containers `c` and `d`.
 *
 * @returns The store.
 */
function setup(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'b', { x: 1000, y: 0 });
  seedLeafMain(store, 'b-two', { x: 1300, y: 0 });
  seedLeafMain(store, 'a', { x: 0, y: 0 });
  placeInstance(store, 'b', { parentId: 'a', instanceId: 'slot', x: 20, y: 20 });
  seedLeafMain(store, 'e', { x: 0, y: 400 });
  placeInstance(store, 'b', { parentId: 'e', instanceId: 'slot-e', x: 20, y: 420 });
  seedLeafMain(store, 'c', { x: 2000, y: 0 });
  seedLeafMain(store, 'd', { x: 3000, y: 0 });
  return store;
}

const toC = { slot: { mainId: 'c' } };

/**
 * Overwrites an instance's records directly, as a peer's write arrives.
 *
 * @param store - The store.
 * @param id - The instance.
 * @param overrides - Its new records.
 */
function writeRecords(store: YjsDocumentStore, id: string, overrides: InstanceOverrides): void {
  const object = mustGet(store, id);
  store.transact(ADA, (transaction) => {
    transaction.patchObject(object.id, { overrides });
  });
}

describe('a swap closing a cycle through another instance’s swap', () => {
  it('refuses both commands when the target holds an instance swapped to the container', () => {
    const store = setup();
    // J, an instance of e in c, shows d in its slot; d holds I, an instance of a.
    placeInstance(store, 'e', {
      parentId: 'c',
      instanceId: 'j',
      x: 2020,
      y: 20,
      overrides: { 'slot-e': { mainId: 'd' } },
    });
    const placed = placeInstance(store, 'a', { parentId: 'd', instanceId: 'i', x: 3020 });
    expect([...containingMains(store, mustGet(store, placed))].sort()).toEqual(['c', 'd']);
    const set = { id: placed, path: 'slot', override: { mainId: 'c' } };
    expect(codesOf(expectRejected(store, setInstanceOverrideCommand, set))).toEqual([
      'instance-cycle',
    ]);
    const created = expectRejected(store, createInstanceCommand, {
      componentId: 'a',
      parentId: 'd',
      instanceId: 'i-two',
      x: 3040,
      y: 40,
      overrides: toC,
    });
    expect(codesOf(created)).toEqual(['instance-cycle']);
    expect(store.get('i-two' as ObjectId)).toBeUndefined();
  });

  it('refuses it when the swap is in the preset J selects', () => {
    const store = setup();
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'e',
      axes: [{ name: 'state', values: ['rest', 'hover'] }],
    });
    const placed = placeInstance(store, 'a', { parentId: 'd', instanceId: 'i', x: 3020 });
    applyCommand(store, mustFindCommand('setVariantPreset'), {
      componentId: 'e',
      axis: 'state',
      value: 'hover',
      path: 'slot-e',
      override: { mainId: 'd' },
    });
    placeInstance(store, 'e', {
      parentId: 'c',
      instanceId: 'j',
      x: 2020,
      y: 20,
      variant: { state: 'hover' },
    });
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: placed,
          path: 'slot',
          override: { mainId: 'c' },
        }),
      ),
    ).toEqual(['instance-cycle']);
    // A preset of `a` may not swap in c either: c reaches d through J's preset, d holds I.
    applyCommand(store, mustFindCommand('setVariantAxes'), {
      componentId: 'a',
      axes: [{ name: 'size', values: ['small', 'large'] }],
    });
    const preset = expectRejected(store, mustFindCommand('setVariantPreset'), {
      componentId: 'a',
      axis: 'size',
      value: 'large',
      path: 'slot',
      override: { mainId: 'c' },
    });
    expect(codesOf(preset)).toEqual(['instance-cycle']);
  });

  it('accepts the target when J’s swap names an unrelated main', () => {
    const store = setup();
    placeInstance(store, 'e', {
      parentId: 'c',
      instanceId: 'j',
      x: 2020,
      y: 20,
      overrides: { 'slot-e': { mainId: 'b-two' } },
    });
    const placed = placeInstance(store, 'a', { parentId: 'd', instanceId: 'i', x: 3020 });
    applyCommand(store, setInstanceOverrideCommand, {
      id: placed,
      path: 'slot',
      override: { mainId: 'c' },
    });
  });

  it('ends on a swap cycle a peer stored, refusing only what closes a cycle', () => {
    const store = setup();
    placeInstance(store, 'b', { parentId: 'c', instanceId: 'c-in', x: 2020, y: 20 });
    placeInstance(store, 'b', { parentId: 'd', instanceId: 'd-in', x: 3020, y: 20 });
    // c shows d and d shows c: a cycle no command makes, which reading falls back from.
    writeRecords(store, 'c-in', { x: { mainId: 'd' as ObjectId } });
    writeRecords(store, 'd-in', { x: { mainId: 'c' as ObjectId } });
    const root = placeInstance(store, 'a', { instanceId: 'root', x: 4000 });
    applyCommand(store, setInstanceOverrideCommand, { id: root, path: 'slot', override: toC.slot });
    const inside = placeInstance(store, 'a', { parentId: 'd', instanceId: 'inside', x: 3040 });
    expect([...containingMains(store, mustGet(store, inside))].sort()).toEqual(['c', 'd']);
    expect(
      codesOf(
        expectRejected(store, setInstanceOverrideCommand, {
          id: inside,
          path: 'slot',
          override: toC.slot,
        }),
      ),
    ).toEqual(['instance-cycle']);
  });

  it('follows stored instances alone for a reader that cannot read the whole board', () => {
    const store = setup();
    placeInstance(store, 'e', {
      parentId: 'c',
      instanceId: 'j',
      x: 2020,
      y: 20,
      overrides: { 'slot-e': { mainId: 'd' } },
    });
    const placed = placeInstance(store, 'a', { parentId: 'd', instanceId: 'i', x: 3020 });
    const narrow = { get: (id: ObjectId) => store.get(id), references: store.references };
    expect([...containingMains(narrow, mustGet(store, placed))]).toEqual(['d']);
  });
});
