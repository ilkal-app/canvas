import { describe, expect, it } from 'vitest';

import {
  detachCommentsFrom,
  detachConnectorsFrom,
  objectToBoardTransform,
  validateBoard,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { ADA, fixtureBoard, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import { ReferenceIndex } from '../store/reference-index.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { LastKnownBoard } from './last-known-board.js';
import { LastKnownObjects } from './last-known-objects.js';
import {
  applyReferenceRepair,
  isEmptyRepair,
  planReferenceRepair,
  type ReferenceRepairPlan,
} from './reference-repair.js';

it('moves children out of a rotated leaf without detaching connectors from that leaf', () => {
  const group = { ...fixtureObject('group-diagram', 'group'), parentId: null, rotation: 0.2 };
  const leaf = { ...fixtureObject('shape-box', 'shape'), parentId: group.id, rotation: 0.5 };
  const child = { ...fixtureObject('sticky-idea', 'sticky'), parentId: leaf.id, rotation: 0.1 };
  const connector = {
    ...fixtureObject('connector-flow', 'connector'),
    parentId: null,
    from: { kind: 'object' as const, objectId: leaf.id, anchor: null },
    to: { kind: 'point' as const, x: 500, y: 100 },
  };
  const objects = [group, leaf, child, connector];
  const { view, before } = rawBoardWith(objects);
  const board = {
    objects: new Map<ObjectId, BoardObject>(objects.map((object) => [object.id, object])),
  };
  const placed = objectToBoardTransform(board, child);
  // Only the parent is listed: replacing its type must still find its unchanged children.
  const plan = planReferenceRepair(view, before, [leaf.id]);
  expect(plan.deleted).toEqual([]);
  expect(plan.updated).toHaveLength(1);
  const moved = plan.updated[0];
  expect(moved?.parentId).toBe(group.id);
  if (moved === undefined) throw new Error('Expected a repaired child');
  board.objects.set(moved.id, moved);
  const after = objectToBoardTransform(board, moved);
  for (const key of ['x', 'y', 'cos', 'sin'] as const)
    expect(after[key]).toBeCloseTo(placed[key], 10);
  expect(board.objects.get(connector.id)).toBe(connector);
  const repaired = rawBoardWith([...board.objects.values()]);
  expect(planReferenceRepair(repaired.view, repaired.before, [leaf.id])).toEqual({
    updated: [],
    deleted: [],
  });
});

it('waits for an unreadable parent instead of treating it as a leaf', () => {
  const child = { ...fixtureObject('sticky-idea', 'sticky'), parentId: id('unreadable') };
  const { view, before } = rawBoardWith([child]);
  const pending = { ...view, isPresent: () => true };
  expect(planReferenceRepair(pending, before, [child.id, id('unreadable')])).toEqual({
    updated: [],
    deleted: [],
  });
});

// The planner on its own, over boards built by local writes (which the store does not repair,
// unlike `applyUpdate`), with the removed objects remembered by hand: each rule, what the
// geometry is measured on, determinism and idempotence.

/**
 * A board and what the planner reads it through.
 *
 * @param objects - The objects on the board now.
 * @param removed - The objects removed from it, as last seen, in one batch.
 * @returns The store, its view and the last-known board.
 */
function boardWith(objects: readonly BoardObject[], removed: readonly BoardObject[] = []) {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const lastKnown = new LastKnownObjects();
  lastKnown.recordRemoved(removed);
  const view = { get: (objectId: ObjectId) => store.get(objectId), isPresent: has(store) };
  return { store, view, before: new LastKnownBoard(store, lastKnown) };
}

/**
 * A board held as written, parent cycles included, and what the planner reads it through: a
 * store shows a stored parent cycle broken, so the planner's walks below a cycle are
 * tested on plain objects and reverse indexes.
 *
 * @param objects - The objects on the board now.
 * @param removed - The objects removed from it, as last seen, in one batch.
 * @returns Its view and the last-known board.
 */
function rawBoardWith(objects: readonly BoardObject[], removed: readonly BoardObject[] = []) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const references = new ReferenceIndex();
  references.apply(objects.map((next) => ({ previous: undefined, next })));
  const board = { get: (objectId: ObjectId) => byId.get(objectId), references };
  const lastKnown = new LastKnownObjects();
  lastKnown.recordRemoved(removed);
  const view = { get: board.get, isPresent: (objectId: ObjectId) => byId.has(objectId) };
  return { view, before: new LastKnownBoard(board, lastKnown) };
}

/**
 * Whether a store holds an object.
 *
 * @param store - The store.
 * @returns The predicate.
 */
function has(store: YjsDocumentStore): (objectId: ObjectId) => boolean {
  return (objectId) => store.get(objectId) !== undefined;
}

/**
 * The fixture board without some objects.
 *
 * @param removed - The ids to leave out.
 * @returns The remaining objects, and the removed ones.
 */
function fixtureWithout(...removed: string[]): [BoardObject[], BoardObject[]] {
  const all = [...fixtureBoard().objects.values()];
  return [
    all.filter((object) => !removed.includes(object.id)),
    all.filter((object) => removed.includes(object.id)),
  ];
}

/**
 * Writes a plan in one transaction.
 *
 * @param store - The store.
 * @param plan - The plan.
 * @returns The ids written.
 */
function apply(store: YjsDocumentStore, plan: ReferenceRepairPlan): ObjectId[] {
  return store.transact(ADA, (transaction) => applyReferenceRepair(transaction, plan));
}

const FIXTURE: Board = fixtureBoard();

describe('planReferenceRepair', () => {
  it('plans nothing when every reference is on the board', () => {
    const { view, before } = boardWith([...FIXTURE.objects.values()]);
    const plan = planReferenceRepair(view, before, FIXTURE.objects.keys());
    expect(isEmptyRepair(plan)).toBe(true);
  });

  it('re-parents the children of a removed group to its last known parent, in place', () => {
    const [objects, removed] = fixtureWithout('group-diagram');
    const { store, view, before } = boardWith(objects, removed);
    const plan = planReferenceRepair(view, before, [id('group-diagram')]);
    expect(plan.updated.map(({ id: objectId }) => objectId)).toEqual(['shape-box', 'shape-star']);
    expect(plan.updated.map(({ parentId }) => parentId)).toEqual(['frame-plan', 'frame-plan']);
    for (const object of plan.updated) {
      const was = objectToBoardTransform(FIXTURE, mustGet(store, object.id));
      const now = objectToBoardTransform({ objects: new Map([...store.read().objects]) }, object);
      for (const key of ['cos', 'sin', 'x', 'y'] as const) expect(now[key]).toBeCloseTo(was[key]);
    }
  });

  it('stacks re-parented children on top of their new siblings, in their old order', () => {
    const [objects, removed] = fixtureWithout('group-diagram');
    const { store, view, before } = boardWith(objects, removed);
    const plan = planReferenceRepair(view, before, [id('group-diagram')]);
    const [box, star] = plan.updated.map(({ z }) => z);
    // shape-box (a0 in the group) below shape-star (a1), both above the frame's top child.
    const top = mustGet(store, 'sticky-idea').z;
    expect(box !== undefined && star !== undefined && top < box && box < star).toBe(true);
  });

  it('breaks a tie in z by id when stacking re-parented children', () => {
    const [objects] = fixtureWithout('group-diagram');
    const group = fixtureObject('group-diagram', 'group');
    const children = ['shape-b', 'shape-a'].map((objectId) => ({
      ...fixtureObject('shape-box', 'shape'),
      id: id(objectId),
      label: null,
    }));
    const { view, before } = boardWith([...objects, ...children], [group]);
    const plan = planReferenceRepair(
      view,
      before,
      children.map(({ id: objectId }) => objectId),
    );
    const [first, second] = plan.updated;
    expect([first?.id, second?.id]).toEqual(['shape-a', 'shape-b']);
    expect((first?.z ?? '') < (second?.z ?? '')).toBe(true);
  });

  it('detaches a connector end on a removed object to where the object was last seen', () => {
    const [objects, removed] = fixtureWithout('sticky-idea');
    const { view, before } = boardWith(objects, removed);
    const plan = planReferenceRepair(view, before, [id('sticky-idea')]);
    const expected = detachConnectorsFrom(FIXTURE, [id('sticky-idea')]).objects.get(
      id('connector-flow'),
    );
    expect(plan).toEqual({ updated: [expected], deleted: [] });
  });

  it('deletes a connector with both ends on removed objects, and re-pins a comment on it', () => {
    const [objects, removed] = fixtureWithout('sticky-idea', 'group-diagram', 'shape-box');
    const comment = {
      ...fixtureObject('comment-on-photo', 'comment'),
      anchor: { kind: 'object', objectId: id('connector-flow'), offset: { x: 3, y: 4 } },
    } as const;
    const { view, before } = boardWith(
      objects.map((object) => (object.id === comment.id ? comment : object)),
      removed,
    );
    const plan = planReferenceRepair(view, before, [id('sticky-idea'), id('shape-box')]);
    expect(plan.deleted).toEqual(['connector-flow']);
    const withComment: Board = {
      objects: new Map([...FIXTURE.objects, [comment.id, comment]]),
    };
    const pinned = detachCommentsFrom(withComment, [id('connector-flow')]).objects.get(comment.id);
    expect(plan.updated.find(({ id: objectId }) => objectId === comment.id)).toEqual(pinned);
  });

  it('re-pins a comment on a removed object where the pin was', () => {
    const [objects, removed] = fixtureWithout('image-photo');
    const { view, before } = boardWith(objects, removed);
    const plan = planReferenceRepair(view, before, [id('image-photo')]);
    const expected = detachCommentsFrom(FIXTURE, [id('image-photo')]).objects.get(
      id('comment-on-photo'),
    );
    expect(plan).toEqual({ updated: [expected], deleted: [] });
  });

  it('is idempotent: once applied, the same call plans nothing', () => {
    const [objects, removed] = fixtureWithout('frame-plan', 'sticky-idea');
    const { store, view, before } = boardWith(objects, removed);
    const touched = [id('frame-plan'), id('sticky-idea')];
    const written = apply(store, planReferenceRepair(view, before, touched));
    expect(written.length).toBeGreaterThan(0);
    expect(validateBoard(store.read())).toEqual([]);
    expect(isEmptyRepair(planReferenceRepair(view, before, [...written, ...touched]))).toBe(true);
  });

  it('is deterministic: two boards with the same objects plan the same writes', () => {
    const [objects, removed] = fixtureWithout('frame-plan', 'image-photo');
    const touched = [id('frame-plan'), id('image-photo')];
    const first = boardWith(objects, removed);
    const second = boardWith([...objects].reverse(), removed);
    expect(planReferenceRepair(second.view, second.before, [...touched].reverse())).toEqual(
      planReferenceRepair(first.view, first.before, touched),
    );
  });

  it('does not treat an entry that is present but unreadable as removed', () => {
    const [objects, removed] = fixtureWithout('group-diagram');
    const { store, before } = boardWith(objects, removed);
    const view = {
      get: (objectId: ObjectId) => store.get(objectId),
      isPresent: (objectId: ObjectId) => objectId === 'group-diagram' || has(store)(objectId),
    };
    expect(isEmptyRepair(planReferenceRepair(view, before, [id('shape-box')]))).toBe(true);
  });

  it('detaches without geometry below a parent cycle, and roots an object whose parent was never seen', () => {
    const group = fixtureObject('group-diagram', 'group');
    const connector = fixtureObject('connector-flow', 'connector');
    const comment = fixtureObject('comment-on-photo', 'comment');
    const shape = fixtureObject('shape-box', 'shape');
    const loopA = { ...group, id: id('loop-a'), parentId: id('loop-b') };
    const loopB = { ...group, id: id('loop-b'), parentId: id('loop-a') };
    const { view, before } = rawBoardWith(
      [
        loopA,
        loopB,
        { ...connector, parentId: loopA.id },
        { ...comment, parentId: loopA.id },
        { ...shape, parentId: id('nowhere'), label: null },
        // Pinned to an object that is still there, and rooted because its parent is not.
        {
          ...comment,
          id: id('comment-kept'),
          parentId: id('nowhere'),
          anchor: { kind: 'object', objectId: shape.id, offset: { x: 1, y: 2 } },
        },
      ],
      [fixtureObject('sticky-idea', 'sticky'), fixtureObject('image-photo', 'image')],
    );
    const plan = planReferenceRepair(view, before, [
      id('sticky-idea'),
      id('image-photo'),
      shape.id,
      id('comment-kept'),
    ]);
    expect(plan.updated.map(({ id: objectId }) => objectId)).toEqual(
      [connector.id, comment.id, shape.id, id('comment-kept')].sort(),
    );
    const byId = new Map(plan.updated.map((object) => [object.id, object]));
    expect(byId.get(connector.id)).toMatchObject({
      from: { kind: 'point', x: 0, y: 0 },
      to: connector.to,
    });
    expect(byId.get(comment.id)).toMatchObject({ anchor: { kind: 'point' }, x: comment.x });
    expect(byId.get(shape.id)).toMatchObject({ parentId: null, x: shape.x, y: shape.y });
    expect(byId.get(id('comment-kept'))).toMatchObject({
      parentId: null,
      anchor: { kind: 'object', objectId: shape.id },
    });
  });

  it('puts an end on a target nothing is known of at the other end, attached', () => {
    // sticky-idea is neither on the board nor remembered: no geometry for the end on it.
    const [objects] = fixtureWithout('sticky-idea');
    const { view, before } = boardWith(objects);
    const plan = planReferenceRepair(view, before, [id('connector-flow')]);
    // Measured where it was drawn: with the unknown end at the connector's origin, the box's
    // automatic anchor sits on the side nearest that origin.
    const measured = detachConnectorsFrom({ objects: new Map(objects.map((o) => [o.id, o])) }, [
      id('shape-box'),
    ]).objects.get(id('connector-flow'));
    const other = measured?.type === 'connector' ? measured.to : undefined;
    expect(other).toMatchObject({ kind: 'point' });
    expect(plan.updated).toEqual([
      { ...fixtureObject('connector-flow', 'connector'), from: other },
    ]);
  });

  it('puts an end on a target nothing is known of at the other end, free, even below a cycle', () => {
    const group = fixtureObject('group-diagram', 'group');
    const loopA = { ...group, id: id('loop-a'), parentId: id('loop-b') };
    const loopB = { ...group, id: id('loop-b'), parentId: id('loop-a') };
    const connector = {
      ...fixtureObject('connector-flow', 'connector'),
      to: { kind: 'point', x: 12, y: 34 },
    } as const;
    for (const parentId of [null, loopA.id]) {
      const { view, before } = rawBoardWith([loopA, loopB, { ...connector, parentId }]);
      const plan = planReferenceRepair(view, before, [connector.id]);
      expect(plan.updated).toEqual([
        { ...connector, parentId, from: { kind: 'point', x: 12, y: 34 } },
      ]);
    }
  });

  it('writes the rest of a plan when the store refuses one repaired object', () => {
    const [objects, removed] = fixtureWithout('image-photo', 'sticky-idea');
    const { store, view, before } = boardWith(objects, removed);
    const plan = planReferenceRepair(view, before, [id('image-photo'), id('sticky-idea')]);
    // As if a peer that skipped validation had left the connector a stroke the schema refuses.
    const refused = plan.updated.map((object) =>
      object.id === 'connector-flow'
        ? ({ ...object, stroke: { color: [0, 0, 0, 1], width: -1 } } as BoardObject)
        : object,
    );
    const written = apply(store, { ...plan, updated: refused });
    expect(written).toEqual(['comment-on-photo']);
    expect(mustGet(store, 'connector-flow')).toEqual(fixtureObject('connector-flow', 'connector'));
  });
});
