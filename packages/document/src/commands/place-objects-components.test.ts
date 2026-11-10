import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  newRectangle,
  placeInstance,
  seedLeafMain,
} from './__fixtures__/component-boards.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { placeObjectsCommand } from './place-objects.js';

/**
 * A main of one sticky at the origin, its instance beside it and a loose rectangle.
 *
 * @returns The store.
 */
function componentBoard(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  seedLeafMain(store, 'main', { x: 0, y: 0 });
  placeInstance(store, 'main', { instanceId: 'instance', x: 400, y: 0 });
  createChild(store, newRectangle('loose', null, { x: 40, y: 40, width: 20, height: 20 }));
  return store;
}

describe('placeObjects with mains and instances', () => {
  it('takes an object into a main, on top of its children', () => {
    const store = componentBoard();
    const { result } = applyCommand(store, placeObjectsCommand, {
      ids: ['loose'],
      parentId: 'main',
    });
    expect(result).toEqual({ movedIds: ['loose'], reparentedIds: ['loose'] });
    expect(mustGet(store, 'loose').parentId).toBe('main');
    expect(sortedSiblings(store, 'main' as ObjectId)).toEqual(['main-leaf', 'loose']);
  });

  it('refuses an instance as the parent, and an instance inside its own main', () => {
    const store = componentBoard();
    const intoInstance = expectRejected(store, placeObjectsCommand, {
      ids: ['loose'],
      parentId: 'instance',
    });
    expect(intoInstance.map(({ code }) => code)).toEqual(['invalid-parent']);
    const cycle = expectRejected(store, placeObjectsCommand, {
      ids: ['instance'],
      parentId: 'main',
    });
    expect(cycle.map(({ code }) => code)).toEqual(['instance-cycle']);
  });

  it('refuses a retired main as the parent, and anything inside one', () => {
    const store = componentBoard();
    createChild(store, newFrame('inner', 'main', { x: 5, y: 5, width: 10, height: 10 }));
    applyCommand(store, deleteObjectsCommand, { ids: ['main'] });
    expect(mustGet(store, 'main')).toMatchObject({ type: 'component', retired: true });
    for (const parentId of ['main', 'inner']) {
      const errors = expectRejected(store, placeObjectsCommand, { ids: ['loose'], parentId });
      expect(errors.map(({ code }) => code)).toEqual(['retired-main']);
    }
    expect(mustGet(store, 'loose').parentId).toBeNull();
  });
});
