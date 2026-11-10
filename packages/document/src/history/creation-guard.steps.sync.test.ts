import { describe, expect, it } from 'vitest';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { groupCommand } from '../commands/group.js';
import { setStyleCommand } from '../commands/set-style.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import {
  BOB_ENVIRONMENT,
  createClients,
  expectConvergedValidBoards,
  expectUsedUpKeeping,
  moveBy,
  NEW_FRAME,
  newShape,
  ORDERS,
  refill,
  type NewObject,
} from './__fixtures__/creation-fixtures.js';

// Beyond one object: a step that creates several objects is guarded per object; a
// group or frame the step created is kept with what the step created inside it, and an object
// kept keeps its parent; a write to a child protects its parent; and a redo that would delete an
// object again (the redo of a delete) is guarded like an undo of a creation. The product's own
// writes: `creation-guard.product.sync.test.ts`.

/** A group holding two rectangles, as a paste or a duplicate creates it, with local ids. */
const PASTED_GROUP: readonly NewObject[] = [
  { type: 'group', id: 'g', x: 3_000, y: 0, rotation: 0.5 },
  newShape('c1', 'g'),
  { ...newShape('c2', 'g'), x: 200 },
];

/**
 * Creates objects in one step, as Ada (a paste).
 *
 * @param store - Ada's store.
 * @param objects - The objects, with local ids.
 * @returns The new ids, in input order.
 */
function paste(store: DocumentStore, objects: readonly NewObject[]): readonly string[] {
  return applyCommand(store, createObjectsCommand, { objects: [...objects] }).result.ids;
}

/**
 * A copy of a store's board.
 *
 * @param store - The store.
 * @returns The board.
 */
function boardOf(store: DocumentStore) {
  return { objects: new Map(store.read().objects) };
}

describe.each(ORDERS)('undoing a creation step ($name)', ({ adaClientId, bobClientId }) => {
  it('removes the objects nobody else touched and keeps the one another client did', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const [one = '', two = ''] = paste(ada, [newShape('one'), { ...newShape('two'), x: 300 }]);
    link.deliver();
    refill(bob, one, [0, 0, 1, 1]);
    link.deliver();
    const kept = mustGet(ada, one);

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, one)).toEqual(kept);
    expect(ada.get(two as never)).toBeUndefined();
    expectConvergedValidBoards(ada, bob);

    expect(history.redo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, two)).toMatchObject({ x: 300 });
    expectConvergedValidBoards(ada, bob);
  });

  it('keeps a pasted group whole when another client moved the group', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const ids = paste(ada, PASTED_GROUP);
    link.deliver();
    moveBy(bob, ids[0] ?? '', 50);
    link.deliver();
    const before = boardOf(ada);

    expect(history.undo()).toBe(false);
    link.deliver();
    for (const pasted of ids)
      expect(mustGet(ada, pasted)).toEqual(before.objects.get(pasted as never));
    expect(history.canRedo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });
});

describe.each(ORDERS)('a write to a child ($name)', ({ adaClientId, bobClientId }) => {
  // The owner's rule (fix round 1, I2): a write by another client to any current direct child of
  // an object, of any kind, protects the object's creation.
  it('keeps a group Ada made when Bob restyled one of its members', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link } = clients;
    const input = { ids: ['image-photo', 'line-divider'], groupId: 'group-new' };
    const group = applyCommand(ada, groupCommand, input).result.groupId;
    link.deliver();
    const style = { changes: [{ id: 'image-photo', style: { opacity: 0.3 } }] };
    applyCommand(bob, setStyleCommand, style, BOB, BOB_ENVIRONMENT);
    link.deliver();

    expectUsedUpKeeping(clients, group);
    expect(mustGet(ada, 'image-photo')).toMatchObject({ parentId: group, opacity: 0.3 });
    expect(mustGet(ada, 'line-divider').parentId).toBe(group);
  });

  it('keeps a pasted frame and its child when Bob restyled the child', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link, history } = clients;
    const [frame = '', child = ''] = paste(ada, [NEW_FRAME, newShape('child', 'frame-new')]);
    link.deliver();
    refill(bob, child, [0, 0, 1, 1]);
    link.deliver();
    const before = boardOf(ada);

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, frame)).toEqual(before.objects.get(frame as never));
    expect(mustGet(ada, child)).toEqual(before.objects.get(child as never));
    expect(history.canRedo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });
});

describe.each(ORDERS)('redoing a delete ($name)', ({ adaClientId, bobClientId }) => {
  it('keeps an object another client edited after the delete was undone', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    applyCommand(ada, deleteObjectsCommand, { ids: ['image-photo'] });
    expect(history.undo()).toBe(true);
    link.deliver();
    const input = { changes: [{ id: 'image-photo', style: { opacity: 0.4 } }] };
    applyCommand(bob, setStyleCommand, input, BOB, BOB_ENVIRONMENT);
    link.deliver();
    const photo = mustGet(ada, 'image-photo');

    expect(history.redo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(photo);
    expect(mustGet(bob, 'image-photo')).toMatchObject({ opacity: 0.4 });
    expect(history.canRedo()).toBe(false);
    expect(history.canUndo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });
});
