// Independent Red-lane acceptance: created instances check resolved override records.
import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  newText,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { codesOf, mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';
import { createInstanceCommand } from './create-instance.js';
import { createObjectsCommand } from './create-objects.js';

function instance(mainId: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'instance',
    id: 'copy',
    parentId: null,
    mainId,
    x: 600,
    y: 0,
    width: 400,
    height: 300,
    overrides,
  };
}

function expectSameRefusal(
  store: YjsDocumentStore,
  mainId: string,
  given: Record<string, unknown>,
  resolved: Record<string, unknown>,
  expectedCode: string,
  expectedPath: readonly (string | number)[],
): void {
  const reference = expectRejected(store, createInstanceCommand, {
    componentId: mainId,
    x: 600,
    y: 0,
    overrides: resolved,
  });
  expect(codesOf(reference)).toEqual([expectedCode]);
  const errors = expectRejected(store, createObjectsCommand, {
    objects: [
      newRectangle('unrelated', null, { x: 0, y: 0, width: 20, height: 20 }),
      instance(mainId, given),
    ],
  });
  expect(codesOf(errors)).toEqual(codesOf(reference));
  expect(errors[0]?.message).toBe(reference[0]?.message);
  expect(errors[0]?.path).toEqual(expectedPath);
}

function swapBoard(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'icon-a', { x: 1000, y: 0 });
  seedLeafMain(store, 'icon-b', { x: 1300, y: 0 });
  seedLeafMain(store, 'button', { x: 0, y: 0 });
  placeInstance(store, 'icon-a', { parentId: 'button', instanceId: 'slot', x: 20, y: 20 });
  return store;
}

describe('createObjects validates created instance overrides', () => {
  it('refuses an unsupported field on a stored main child and writes none of the objects', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    expectSameRefusal(
      store,
      mainId,
      { [boxId]: { color: [0, 1, 0, 1] } },
      { [boxId]: { color: [0, 1, 0, 1] } },
      'invalid-override',
      ['objects', 1, 'overrides', boxId],
    );
    store.destroy();
  });

  it('locates an unsupported field given by layer name at its resolved id path', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId } = seedMainWithChildren(store);
    applyCommand(store, mustFindCommand('renameObject'), { id: boxId, name: 'Box' });
    expectSameRefusal(
      store,
      mainId,
      { Box: { color: [0, 1, 0, 1] } },
      { [boxId]: { color: [0, 1, 0, 1] } },
      'invalid-override',
      ['objects', 1, 'overrides', boxId],
    );
    store.destroy();
  });

  it('refuses a swap outside the slot swap options as createInstance does', () => {
    const store = swapBoard();
    const slot = mustGet(store, 'slot') as InstanceObject;
    store.transact(ADA, (transaction) => {
      transaction.patchObject(slot.id, { swapOptions: ['icon-a'] as ObjectId[] });
    });
    const overrides = { slot: { mainId: 'icon-b' } };
    expectSameRefusal(store, 'button', overrides, overrides, 'invalid-override', [
      'objects',
      1,
      'overrides',
      'slot',
      'mainId',
    ]);
    store.destroy();
  });

  it('refuses a swap that would make the slot expand its ancestor', () => {
    const store = swapBoard();
    const overrides = { slot: { mainId: 'button' } };
    expectSameRefusal(store, 'button', overrides, overrides, 'instance-cycle', [
      'objects',
      1,
      'overrides',
      'slot',
      'mainId',
    ]);
    store.destroy();
  });

  it('accepts a valid override on a main and child created earlier in the same call', () => {
    const store = new YjsDocumentStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        {
          type: 'component',
          id: 'card',
          parentId: null,
          name: 'Card',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          retired: false,
        },
        { ...newText('title', 'card', { x: 0, y: 0, width: 120, height: 40 }), name: 'Title' },
        instance('card', { title: { text: 'Changed' } }),
      ] as never,
    });
    expect(overridesOf(store, result.ids[2] ?? '')).toEqual({
      [result.ids[1] ?? '']: { text: 'Changed' },
    });
    store.destroy();
  });

  it('refuses an unsupported field on a child of a main created in the same call', () => {
    const store = new YjsDocumentStore();
    const ids = testEnvironment().createId;
    ids(); // The listed main receives the first generated id.
    const resolvedBoxId = ids();
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [
        {
          type: 'component',
          id: 'card',
          parentId: null,
          name: 'Card',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          retired: false,
        },
        newRectangle('box', 'card', { x: 0, y: 0, width: 80, height: 80 }),
        instance('card', { box: { color: [0, 1, 0, 1] } }),
      ],
    });
    expect(codesOf(errors)).toEqual(['invalid-override']);
    expect(errors[0]?.message).toMatch(/^The child does not support these override fields\./);
    expect(errors[0]?.path).toEqual(['objects', 2, 'overrides', resolvedBoxId]);
    store.destroy();
  });

  it('accepts a text override and an allowed swap', () => {
    const store = swapBoard();
    const { mainId, captionId } = seedMainWithChildren(store, { prefix: 'card' });
    const slot = mustGet(store, 'slot') as InstanceObject;
    store.transact(ADA, (transaction) => {
      transaction.patchObject(slot.id, { swapOptions: ['icon-a', 'icon-b'] as ObjectId[] });
    });
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        instance(mainId, { [captionId]: { text: 'Changed' } }),
        { ...instance('button', { slot: { mainId: 'icon-b' } }), id: 'swapped-copy' },
      ] as never,
    });
    expect(overridesOf(store, result.ids[0] ?? '')).toEqual({ [captionId]: { text: 'Changed' } });
    expect(overridesOf(store, result.ids[1] ?? '')).toEqual({ slot: { mainId: 'icon-b' } });
    store.destroy();
  });

  it('refuses an autoLayout patch on a frame without auto-layout', () => {
    const store = new YjsDocumentStore();
    const frameId = createChild(
      store,
      newFrame('plain', null, { x: 0, y: 0, width: 100, height: 100 }),
    );
    applyCommand(store, mustFindCommand('createComponent'), {
      ids: [frameId],
      name: 'Plain',
      componentId: 'plain-main',
    });
    const overrides = { [frameId]: { autoLayout: { gap: 12 } } };
    expectSameRefusal(store, 'plain-main', overrides, overrides, 'invalid-override', [
      'objects',
      1,
      'overrides',
      frameId,
      'autoLayout',
    ]);
    store.destroy();
  });
});
