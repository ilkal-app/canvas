// Acceptance: detach and duplication preserve the effective nested main.
import { describe, expect, it } from 'vitest';

import type { InstanceObject, InstanceOverrides, ObjectId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';
import { copyInstanceOverrides } from './copy-instance-overrides.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';
import { SubBoard } from './sub-board.js';

const GREEN: [number, number, number, number] = [0.2, 0.9, 0.2, 1];

function setup() {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'icon-a', { x: 1000, y: 0 });
  const bChild = seedLeafMain(store, 'icon-b', { x: 1300, y: 0 });
  seedLeafMain(store, 'button', { x: 0, y: 0 });
  placeInstance(store, 'icon-a', {
    parentId: 'button',
    instanceId: 'slot',
    x: 20,
    y: 20,
  });
  const placed = placeInstance(store, 'button', { instanceId: 'placed', x: 2000, y: 0 });
  applyCommand(store, setInstanceOverrideCommand, {
    id: placed,
    path: 'slot',
    override: { mainId: 'icon-b' },
  });
  const instance = mustGet(store, placed) as InstanceObject;
  store.transact(ADA, (transaction) => {
    transaction.patchObject(instance.id, {
      overrides: { slot: { mainId: 'icon-b' as ObjectId }, [`slot/${bChild}`]: { color: GREEN } },
    });
  });
  return { store, placed, bChild };
}

describe('swapped instance detach and copy', () => {
  it('detaches a swapped slot into an instance of its effective main with re-rooted overrides', () => {
    const { store, placed, bChild } = setup();
    const before = mustGet(store, placed);
    const history = createHistory(store, ADA.principalId);
    const { result } = applyCommand(store, mustFindCommand('detachInstance'), { id: placed });
    const createdIds = (result as { createdIds: readonly ObjectId[] }).createdIds;
    const nested = createdIds
      .map((id) => store.get(id))
      .find((object) => object?.type === 'instance');
    expect(nested).toMatchObject({
      parentId: placed,
      mainId: 'icon-b',
      overrides: { [bChild]: { color: GREEN } },
    });
    expect(nested?.overrides).not.toHaveProperty('slot');
    expect(history.undo()).toBe(true);
    expect(mustGet(store, placed)).toEqual(before);
    for (const id of createdIds) expect(store.get(id)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });

  it('remaps a copied swap record’s mainId only when the swapped main is copied', () => {
    const record: InstanceOverrides = {
      slot: { mainId: 'icon-b' as ObjectId },
      'slot/icon-b-leaf': { color: GREEN },
    };
    const copies = new Map<ObjectId, ObjectId>([
      ['button', 'button-copy'],
      ['slot', 'slot-copy'],
      ['icon-b', 'icon-b-copy'],
      ['icon-b-leaf', 'icon-b-leaf-copy'],
    ] as [ObjectId, ObjectId][]);
    const sourceMain = (id: ObjectId) => (id === 'slot' ? ('icon-a' as ObjectId) : undefined);
    expect(copyInstanceOverrides(record, 'button' as ObjectId, copies, sourceMain)).toEqual({
      'slot-copy': { mainId: 'icon-b-copy' },
      'slot-copy/icon-b-leaf-copy': { color: GREEN },
    });
    copies.delete('icon-b' as ObjectId);
    expect(copyInstanceOverrides(record, 'button' as ObjectId, copies, sourceMain)).toEqual({
      'slot-copy': { mainId: 'icon-b' },
      'slot-copy/icon-b-leaf': { color: GREEN },
    });
  });

  it('createObjects remaps the swap and its deep path in a copied definition', () => {
    const { store, bChild } = setup();
    const sources = [...store.read().objects.values()];
    const objects = sources.map((object) =>
      Object.fromEntries(
        Object.entries(object).filter(
          ([key]) => !['z', 'createdBy', 'createdAt', 'updatedAt'].includes(key),
        ),
      ),
    );
    const { changes } = applyCommand(store, mustFindCommand('createObjects'), { objects });
    const copied = changes.created.map((id) => store.get(id));
    const copiedButton = copied.find(
      (object) => object?.type === 'component' && object.name === 'button',
    );
    const copiedIcon = copied.find(
      (object) => object?.type === 'component' && object.name === 'icon-b',
    );
    const copiedSlot = copied.find(
      (object) => object?.type === 'instance' && object.parentId === copiedButton?.id,
    );
    const copiedPlaced = copied.find(
      (object) =>
        object?.type === 'instance' &&
        object.parentId === null &&
        object.mainId === copiedButton?.id,
    );
    const copiedLeaf = copied.find(
      (object) => object?.type === 'sticky' && object.parentId === copiedIcon?.id,
    );
    expect(copiedSlot).toBeDefined();
    expect(copiedIcon).toBeDefined();
    expect(copiedLeaf?.id).not.toBe(bChild);
    expect(copiedPlaced).toMatchObject({
      overrides: {
        [copiedSlot?.id ?? 'missing']: { mainId: copiedIcon?.id },
        [`${copiedSlot?.id ?? 'missing'}/${copiedLeaf?.id ?? 'missing'}`]: { color: GREEN },
      },
    });
  });

  it('SubBoard includes the swapped-in main and its definition', () => {
    const { store, placed, bChild } = setup();
    const board = new SubBoard(store, [mustGet(store, placed)]);
    board.addInstanceDefinitions(placed);
    expect(board.toBoard().objects.get('icon-b' as ObjectId)).toMatchObject({ type: 'component' });
    expect(board.toBoard().objects.get(bChild)).toMatchObject({ parentId: 'icon-b' });
    expect(overridesOf(store, placed).slot).toEqual({ mainId: 'icon-b' });
  });
});
