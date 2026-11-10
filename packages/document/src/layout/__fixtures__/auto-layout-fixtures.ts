import { importBoard, type AutoLayout, type BoardObject, type ObjectId } from '@canvas/schema';

import { createFixtureBoardJson } from '../../codec/__fixtures__/fixture-board-json.js';
import { ADA, fixtureObject } from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';

// Boards for the auto-layout command tests.

/** A row that hugs both axes, 10 apart, padded 5 all round. */
export const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
};

/**
 * A frame at (100, 100), 400 × 300, at the root.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or null.
 * @param z - Its stacking key.
 * @returns The frame.
 */
export function frame(id: string, parentId: string | null = null, z = 'a0'): BoardObject {
  return {
    ...fixtureObject('frame-plan', 'frame'),
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    pageId: parentId === null ? 'page-1' : null,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    z,
  } as BoardObject;
}

/**
 * A shape box inside a parent.
 *
 * @param id - Its id.
 * @param parentId - Its parent.
 * @param z - Its stacking key (bottom first).
 * @param width - Its width.
 * @param height - Its height.
 * @returns The shape.
 */
export function box(
  id: string,
  parentId: string,
  z: string,
  width: number,
  height: number,
): BoardObject {
  return {
    ...fixtureObject('shape-box', 'shape'),
    id: id as ObjectId,
    parentId: parentId as ObjectId,
    pageId: null,
    x: 0,
    y: 0,
    rotation: 0,
    width,
    height,
    z,
  };
}

/**
 * A store holding the given objects, written in one transaction.
 *
 * @param objects - The objects, parents first.
 * @returns The store.
 */
export function storeWith(...objects: BoardObject[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return store;
}

/**
 * A store holding the fixture board with its component main (`component-card`) and instance
 * (`instance-card`).
 *
 * @returns The store.
 */
export function storeWithComponents(): YjsDocumentStore {
  return storeWith(...importBoard(createFixtureBoardJson(true)).objects.values());
}

/**
 * An object's position and size.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns `[x, y, width, height]`.
 */
export function rect(store: YjsDocumentStore, id: string): number[] {
  const object = store.get(id as ObjectId) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  return [object.x, object.y, object.width, object.height];
}
