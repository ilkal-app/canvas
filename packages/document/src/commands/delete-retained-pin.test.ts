import { describe, expect, it } from 'vitest';

import { importBoard, validateBoard, type BoardObject, type ObjectId } from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { ADA, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';

// Found by sync-fuzz (seed 4): deleting a main that has an instance retires it and
// keeps its content, which the cascade does not see; a comment in that content pinned to an
// object deleted with the main kept its pin to the deleted object, and the board failed
// `validateBoard` (`missing-comment-anchor`).

describe('deleting a main whose kept content pins a deleted object', () => {
  it('re-pins the comment to a point, so the board stays valid', () => {
    const store = new YjsDocumentStore();
    const objects = [...importBoard(createFixtureBoardJson(true)).objects.values()];
    const target = {
      ...fixtureObject('shape-box', 'shape'),
      id: 'pinned-target' as ObjectId,
      z: 'az',
    };
    const pin = {
      ...fixtureObject('comment-on-photo', 'comment'),
      id: 'kept-pin' as ObjectId,
      parentId: 'component-card' as ObjectId,
      pageId: null,
      anchor: { kind: 'object', objectId: target.id, offset: { x: 1, y: 2 } },
    } as BoardObject;
    store.transact(ADA, (transaction) => {
      for (const object of [...objects, target as BoardObject, pin]) transaction.setObject(object);
    });
    expect(validateBoard(store.read())).toEqual([]);

    applyCommand(store, deleteObjectsCommand, { ids: ['component-card', target.id] });

    expect(store.get('component-card' as ObjectId)).toMatchObject({ retired: true });
    expect(store.get(target.id)).toBeUndefined();
    expect(store.get('kept-pin' as ObjectId)).toMatchObject({ anchor: { kind: 'point' } });
    expect(validateBoard(store.read())).toEqual([]);
  });
});
