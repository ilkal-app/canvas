// Two clients, one deleting what the other concurrently builds on: each command is
// valid where it runs, the merge keeps both, and without the repair both clients would hold the
// same board with a dangling parent, connector end or comment anchor. The store repairs after
// every applied update, so both converge to one valid board, in either merge order.
import { describe, expect, it } from 'vitest';

import { detachCommentsFrom, detachConnectorsFrom } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { connectCommand } from '../commands/connect.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { groupCommand } from '../commands/group.js';
import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { BOB, exchange, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  newShape,
  ORDERS,
  placementOf,
  recordRepairs,
} from './__fixtures__/repair-fixtures.js';

describe.each(ORDERS)('concurrent delete and reparent ($name)', ({ adaClientId, bobClientId }) => {
  it('moves a child put in a deleted group to the group’s parent, where it was', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
    applyCommand(
      bob,
      createObjectCommand,
      { object: newShape('shape-late', 'group-diagram', 40) },
      BOB,
      BOB_ENVIRONMENT,
    );
    const where = placementOf(boardOf(bob), mustGet(bob, 'shape-late'));
    const [adaRepairs, bobRepairs] = [recordRepairs(ada), recordRepairs(bob)];
    link.reconnect();
    const moved = mustGet(ada, 'shape-late');
    expect(moved.parentId).toBe('frame-plan');
    expect(placementOf(boardOf(ada), moved)).toEqual(where);
    // On top of the frame's children, whose top child was the group.
    expect(sortedSiblings(ada, id('frame-plan')).at(-1)).toBe('shape-late');
    // Both clients repaired the same merge, with the system origin, and wrote the same values.
    expect(adaRepairs.map(({ changes }) => changes.origin)).toEqual([SYSTEM_ORIGIN]);
    expect(bobRepairs.map(({ written }) => written)).toEqual(
      adaRepairs.map(({ written }) => written),
    );
    expectValidAndConverged(ada, bob);
  });

  it('moves children of a deleted frame to the root in their order, where they were', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['frame-plan'] });
    for (const [shapeId, x] of [
      ['shape-low', 0],
      ['shape-high', 50],
    ] as const) {
      applyCommand(
        bob,
        createObjectCommand,
        { object: newShape(shapeId, 'group-diagram', x) },
        BOB,
        BOB_ENVIRONMENT,
      );
    }
    const before = boardOf(bob);
    const where = ['shape-low', 'shape-high'].map((shapeId) =>
      placementOf(before, mustGet(bob, shapeId)),
    );
    link.reconnect();
    const moved = ['shape-low', 'shape-high'].map((shapeId) => mustGet(ada, shapeId));
    expect(moved.map(({ parentId }) => parentId)).toEqual([null, null]);
    expect(moved.map((object) => placementOf(boardOf(ada), object))).toEqual(where);
    expect(sortedSiblings(ada, null).slice(-2)).toEqual(['shape-low', 'shape-high']);
    expectValidAndConverged(ada, bob);
  });

  it('leaves a child that a later reparent put in a valid parent before the repair ran', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
    applyCommand(
      bob,
      createObjectCommand,
      { object: newShape('shape-late', 'group-diagram', 40) },
      BOB,
      BOB_ENVIRONMENT,
    );
    // Bob hears of the delete first and repairs; then he groups the shape, a legitimate move.
    bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY);
    expect(mustGet(bob, 'shape-late').parentId).toBe('frame-plan');
    const { groupId } = applyCommand(
      bob,
      groupCommand,
      { ids: ['shape-late', 'text-title'] },
      BOB,
      BOB_ENVIRONMENT,
    ).result;
    // Ada hears of all of it at once, as on reconnection: by then the shape has a valid parent.
    const adaRepairs = recordRepairs(ada);
    ada.applyUpdate(bob.encodeState(ada.encodeStateVector()), RELAY);
    expect(adaRepairs).toEqual([]);
    expect(mustGet(ada, 'shape-late').parentId).toBe(groupId);
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
  });
});

describe.each(ORDERS)('concurrent delete and connect ($name)', ({ adaClientId, bobClientId }) => {
  it('detaches the end on the deleted object to where it was, and keeps the connector', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['sticky-idea'] });
    const connector = applyCommand(
      bob,
      connectCommand,
      {
        from: { objectId: 'sticky-idea', anchor: { x: 0, y: 1 } },
        to: { objectId: 'image-photo' },
      },
      BOB,
      BOB_ENVIRONMENT,
    ).result.id;
    const expected = detachConnectorsFrom(boardOf(bob), [id('sticky-idea')]).objects.get(connector);
    link.reconnect();
    expect(mustGet(ada, connector)).toEqual(expected);
    expect(mustGet(ada, connector)).toMatchObject({
      from: { kind: 'point' },
      to: { kind: 'object', objectId: 'image-photo' },
    });
    expectValidAndConverged(ada, bob);
  });

  it('deletes a connector whose two ends were both deleted, and re-pins its comment', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['sticky-idea', 'image-photo'] });
    const connector = applyCommand(
      bob,
      connectCommand,
      { from: { objectId: 'sticky-idea' }, to: { objectId: 'image-photo' } },
      BOB,
      BOB_ENVIRONMENT,
    ).result.id;
    applyCommand(
      bob,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: 'comment-on-connector',
          x: 0,
          y: 0,
          threadId: 'thread-connector',
          anchor: { kind: 'object', objectId: connector, offset: { x: 5, y: 0 } },
        },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    const pinned = detachCommentsFrom(boardOf(bob), [connector]).objects.get(
      id('comment-on-connector'),
    );
    link.reconnect();
    expect(ada.get(connector)).toBeUndefined();
    expect(mustGet(ada, 'comment-on-connector')).toEqual(pinned);
    expectValidAndConverged(ada, bob);
  });
});

describe.each(ORDERS)('concurrent delete and pin ($name)', ({ adaClientId, bobClientId }) => {
  it('turns a comment pinned to the deleted object into a point pin, where it was', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['video-demo'] });
    applyCommand(
      bob,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: 'comment-late',
          x: 0,
          y: 0,
          threadId: 'thread-late',
          anchor: { kind: 'object', objectId: 'video-demo', offset: { x: 30, y: 40 } },
        },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    const pinned = detachCommentsFrom(boardOf(bob), [id('video-demo')]).objects.get(
      id('comment-late'),
    );
    link.reconnect();
    expect(mustGet(ada, 'comment-late')).toEqual(pinned);
    expect(mustGet(ada, 'comment-late')).toMatchObject({ anchor: { kind: 'point' } });
    expectValidAndConverged(ada, bob);
  });
});
