import { describe, expect, it } from 'vitest';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedLeafMain } from './__fixtures__/component-boards.js';
import { codesOf, fieldOf } from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { setSwapOptionsCommand } from './set-swap-options.js';

function setup(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'icon-a', { x: 1000, y: 0 });
  seedLeafMain(store, 'icon-b', { x: 1300, y: 0 });
  seedLeafMain(store, 'button', { x: 0, y: 0 });
  placeInstance(store, 'icon-a', { parentId: 'button', instanceId: 'slot', x: 20, y: 20 });
  return store;
}

describe('setSwapOptions edges', () => {
  it('refuses a missing instance', () => {
    const store = setup();
    expect(
      codesOf(expectRejected(store, setSwapOptionsCommand, { id: 'gone', options: null })),
    ).toEqual(['missing-object']);
  });

  it('refuses a retired main as an option, pointing at it', () => {
    const store = setup();
    const retired = mustGet(store, 'icon-b');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(retired.id, { retired: true });
    });
    const errors = expectRejected(store, setSwapOptionsCommand, {
      id: 'slot',
      options: ['icon-a', 'icon-b'],
    });
    expect(codesOf(errors)).toEqual(['invalid-input']);
    expect(errors[0]?.path).toEqual(['options', 1]);
  });

  it('clears a list that was never set without failing', () => {
    const store = setup();
    applyCommand(store, setSwapOptionsCommand, { id: 'slot', options: null });
    expect(fieldOf(store, 'slot', 'swapOptions')).toBeUndefined();
  });

  it('leaves no swap options on the frames a detach or a main deletion makes', () => {
    const store = setup();
    applyCommand(store, setSwapOptionsCommand, { id: 'slot', options: ['icon-a', 'icon-b'] });
    const placed = placeInstance(store, 'button', { instanceId: 'placed', x: 2000, y: 0 });
    const { result } = applyCommand(store, deleteObjectsCommand, { ids: ['button', 'icon-a'] });
    expect((result as { detachedIds: readonly string[] }).detachedIds).toContain(placed);
    const frames = [...store.read().objects.values()].filter(({ type }) => type === 'frame');
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame).not.toHaveProperty('swapOptions');
  });
});
