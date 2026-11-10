import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { LastKnownBoard } from './last-known-board.js';
import { LastKnownObjects } from './last-known-objects.js';
import { planReferenceRepair, type RepairView } from './reference-repair.js';

/**
 * A stored board and its last-known objects, as read during repair.
 *
 * @param objects - The objects currently stored.
 * @param removed - The objects remembered after deletion.
 * @returns The current view and remembered board.
 */
function boardWith(objects: readonly BoardObject[], removed: readonly BoardObject[] = []) {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const lastKnown = new LastKnownObjects();
  lastKnown.recordRemoved(removed);
  const view: RepairView = {
    get: (objectId) => store.get(objectId),
    isPresent: (objectId) => store.get(objectId) !== undefined,
  };
  return { view, before: new LastKnownBoard(store, lastKnown) };
}

/**
 * The counted plan must match the ordinary plan and read each id at most once.
 *
 * @param objects - The objects currently stored.
 * @param removed - The objects remembered after deletion.
 * @param touched - The ids affected by the change.
 */
function expectSingleReads(
  objects: readonly BoardObject[],
  removed: readonly BoardObject[],
  touched: readonly ObjectId[],
): void {
  const { view, before } = boardWith(objects, removed);
  const expected = planReferenceRepair(view, before, touched);
  const reads = new Map<ObjectId, number>();
  const counted: RepairView = {
    get: (objectId) => {
      reads.set(objectId, (reads.get(objectId) ?? 0) + 1);
      return view.get(objectId);
    },
    isPresent: (objectId) => view.isPresent(objectId),
  };
  expect(planReferenceRepair(counted, before, touched)).toEqual(expected);
  expect([...reads].filter(([, count]) => count > 1).slice(0, 5)).toEqual([]);
}

describe('planReferenceRepair reads', () => {
  it('reads a touched present leaf once when other people added children beneath it', () => {
    const leaf = fixtureObject('shape-box', 'shape');
    const children = ['leaf-child-a', 'leaf-child-b'].map((name) => ({
      ...fixtureObject('sticky-idea', 'sticky'),
      id: id(name),
      parentId: leaf.id,
    }));
    expectSingleReads(
      [
        fixtureObject('frame-plan', 'frame'),
        fixtureObject('group-diagram', 'group'),
        leaf,
        ...children,
      ],
      [],
      [leaf.id],
    );
  });

  it('reads one present parent once across several touched children', () => {
    const parent = fixtureObject('group-diagram', 'group');
    const children = ['child-a', 'child-b', 'child-c', 'child-d'].map((name) => ({
      ...fixtureObject('shape-box', 'shape'),
      id: id(name),
      parentId: parent.id,
    }));
    expectSingleReads(
      [fixtureObject('frame-plan', 'frame'), parent, ...children],
      [],
      children.map((child) => child.id),
    );
  });

  it('reads dependents once when a touched deleted parent had children, connectors, and comments', () => {
    const removed = fixtureObject('group-diagram', 'group');
    const child = fixtureObject('shape-box', 'shape');
    const connector = {
      ...fixtureObject('connector-flow', 'connector'),
      from: { kind: 'object' as const, objectId: removed.id, anchor: null },
      to: { kind: 'point' as const, x: 500, y: 100 },
    };
    const comment = {
      ...fixtureObject('comment-on-photo', 'comment'),
      anchor: { kind: 'object' as const, objectId: removed.id, offset: { x: 3, y: 4 } },
    };
    expectSingleReads(
      [fixtureObject('frame-plan', 'frame'), child, connector, comment],
      [removed],
      [removed.id],
    );
  });

  it('reads each id once in a hundreds-object repair with dangling references', () => {
    const parent = fixtureObject('group-diagram', 'group');
    const missingParent = id('deleted-parent');
    const children = Array.from({ length: 320 }, (unusedValue, index) => ({
      ...fixtureObject('shape-box', 'shape'),
      id: id(`bulk-child-${String(index).padStart(3, '0')}`),
      parentId: index % 8 === 0 ? missingParent : parent.id,
    }));
    expectSingleReads(
      [fixtureObject('frame-plan', 'frame'), parent, ...children],
      [],
      children.map((child) => child.id),
    );
  });
});
