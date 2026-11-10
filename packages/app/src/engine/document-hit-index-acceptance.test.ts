import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { DocumentHitIndex } from './document-hit-index.js';

const id = (value: string): ObjectId => value as ObjectId;

function objects(isHidden = false): BoardObject[] {
  const shared = { rotation: 0, locked: false, createdBy: 'user:test', createdAt: 1, updatedAt: 1 };
  return [
    { ...shared, id: id('parent'), parentId: null, x: 0, y: 0, z: 'a0', type: 'group', isHidden },
    {
      ...shared,
      id: id('child'),
      parentId: id('parent'),
      x: 10,
      y: 10,
      z: 'a1',
      type: 'shape',
      kind: 'rectangle',
      width: 20,
      height: 20,
      stroke: null,
      fill: [1, 0, 0, 1],
      cornerRadius: 0,
      sides: 4,
      label: null,
    },
  ] as BoardObject[];
}

function setUp(isHidden = false) {
  const store = new YjsDocumentStore({ clientId: 7 });
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects(isHidden)) transaction.setObject(object);
  });
  return { store, hits: new DocumentHitIndex(store) };
}

describe('concealment lookup acceptance', () => {
  // A child must read its ancestors live, or a store
  // subscriber that runs before the index would see a child its newly hidden parent conceals
  // (document-hit-index.test.ts). A root object, the large-drag case, reads nothing more.
  it('reads nothing beyond a root object itself when judging its concealment', () => {
    const { store, hits } = setUp();
    const read = vi.spyOn(store, 'get');
    expect(hits.get(id('parent'))?.id).toBe('parent');
    expect(read.mock.calls.map(([objectId]) => objectId)).toEqual(['parent']);
  });

  it('hides descendants of a hidden ancestor and reveals them after apply', () => {
    const { store, hits } = setUp(true);
    expect(hits.get(id('child'))).toBeUndefined();
    // Also populate any concealment memo twice before changing the ancestor.
    expect(hits.get(id('child'))).toBeUndefined();
    const [visibleParent] = objects(false);
    if (visibleParent === undefined) throw new Error('Missing parent fixture.');
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(visibleParent);
    });
    expect(hits.get(id('child'))?.id).toBe('child');
  });
});
