import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { DocumentBoardView } from './document-board-view.js';
import { DocumentHitIndex } from './document-hit-index.js';

/**
 * A rectangle with no stroke, at a known world position.
 *
 * @param name - Its id.
 * @param x - Its left edge.
 * @param y - Its top edge.
 * @returns The rectangle.
 */
function rectangle(name: string, x: number, y: number): BoardObject {
  return {
    id: name as ObjectId,
    parentId: null,
    rotation: 0,
    locked: false,
    createdBy: 'user:test',
    createdAt: 1,
    updatedAt: 1,
    x,
    y,
    z: `a${name}`,
    type: 'shape',
    kind: 'rectangle',
    width: 100,
    height: 50,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  } as BoardObject;
}

describe('objectsIn acceptance', () => {
  it('reports current drawn bounds through the board view immediately after create, move and delete', () => {
    const store = new YjsDocumentStore({ clientId: 625 });
    const index = new DocumentHitIndex(store);
    const view = new DocumentBoardView(
      store,
      { ids: () => [], select: () => undefined },
      { search: index },
    );
    const oldArea = { minX: -5, minY: -5, maxX: 110, maxY: 60 };
    const newArea = { minX: 295, minY: 195, maxX: 410, maxY: 260 };
    expect(view.objectsIn(oldArea)).toEqual([]);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(rectangle('a', 0, 0));
      transaction.setObject(rectangle('b', 700, 700));
    });
    expect(view.objectsIn(oldArea)).toEqual([
      { id: 'a', bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 } },
    ]);
    expect(index.objectsIn(oldArea)).toEqual(view.objectsIn(oldArea));
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(rectangle('a', 300, 200));
    });
    expect(view.objectsIn(oldArea)).toEqual([]);
    expect(view.objectsIn(newArea)).toEqual([
      { id: 'a', bounds: { minX: 300, minY: 200, maxX: 400, maxY: 250 } },
    ]);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject('a' as ObjectId);
    });
    expect(view.objectsIn(newArea)).toEqual([]);
    view.destroy();
    index.destroy();
  });
});
