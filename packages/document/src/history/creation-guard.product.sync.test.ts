import { describe, expect, it } from 'vitest';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { connectCommand } from '../commands/connect.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { ADA, BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';

import {
  BOB_ENVIRONMENT,
  create,
  createClients,
  expectConvergedValidBoards,
  moveBy,
  NEW_FRAME,
  newShape,
  ORDERS,
  remove,
  sendAll,
} from './__fixtures__/creation-fixtures.js';

// Fix round 1 (I1). The reference repair runs on every client that sees a dangling
// reference, so a peer's repair of a key is nobody's edit. The guard tells it from a person's
// write by `updatedAt`: every command stamps it, the repair never does
// (`creation-guard.writers.test.ts`). Three sequences from the review, in both merge orders.

/** Bob's frame and his shape at the root, clear of the fixture board. */
const BOBS_FRAME = { ...NEW_FRAME, id: 'frame-bob', x: 5_000 };

describe.each(ORDERS)("a repair race, then a person's write ($name)", (order) => {
  // (a) A repair race once left the peer's repair on top of a key; a later person's write of that
  // key (Bob puts his shape into Ada's new frame) is Bob's, whoever won the race.
  it("keeps Ada's frame that Bob put his shape into after an earlier repair race", () => {
    const { ada, bob, link, history } = createClients(order.adaClientId, order.bobClientId);
    create(bob, BOBS_FRAME, BOB);
    const shape = create(bob, newShape('shape-bob'), BOB);
    link.deliver();
    link.disconnect();
    moveBy(ada, shape, 5_000, 'frame-bob', ADA);
    remove(bob, ['frame-bob'], BOB);
    link.reconnect();
    expect(mustGet(ada, shape).parentId).toBeNull();
    const frame = create(ada, NEW_FRAME);
    link.deliver();
    moveBy(bob, shape, 2_000, frame);
    link.deliver();

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, frame)).toEqual(mustGet(bob, frame));
    expect(mustGet(ada, shape).parentId).toBe(frame);
    expectConvergedValidBoards(ada, bob);
  });

  // (b) Bob's write races Ada's own repair of the same key: Bob puts his shape into Ada's frame
  // before Ada's repair of it reaches him. The merge keeps one placement: when Bob's client id
  // is higher his move stays and protects the frame; when Ada's is, her repair wins the key and
  // the merge, not the undo, dropped Bob's move, so the frame is Ada's to remove.
  it("keeps Ada's frame while Bob's move into it, which raced her repair, stays", () => {
    const { ada, bob, link, history } = createClients(order.adaClientId, order.bobClientId);
    create(bob, BOBS_FRAME, BOB);
    const shape = create(bob, newShape('shape-bob'), BOB);
    const frame = create(ada, NEW_FRAME);
    link.deliver();
    link.disconnect();
    moveBy(bob, shape, 5_000, 'frame-bob');
    remove(ada, ['frame-bob']);
    const adasDelete = ada.encodeState(bob.encodeStateVector());
    sendAll(bob, ada); // Ada repairs the shape
    bob.applyUpdate(adasDelete, RELAY); // Bob repairs it too, without Ada's repair
    moveBy(bob, shape, 2_000, frame);
    link.reconnect();
    const isBobsMoveKept = order.bobClientId > order.adaClientId;
    expect(mustGet(ada, shape).parentId).toBe(isBobsMoveKept ? frame : null);

    expect(history.undo()).toBe(true); // Ada's delete of Bob's frame
    link.deliver();
    expect(history.undo()).toBe(!isBobsMoveKept);
    link.deliver();
    expect(ada.get(frame) !== undefined).toBe(isBobsMoveKept);
    expect(mustGet(ada, shape).parentId).toBe(isBobsMoveKept ? frame : null);
    expectConvergedValidBoards(ada, bob);
  });
});

describe.each(ORDERS)("the product's own writes ($name)", (order) => {
  const { adaClientId, bobClientId } = order;
  // Bob deletes the frame while Ada creates a shape in it: both clients repair the shape (to the
  // root, where it was) with the same values, and whichever repair wins, it is nobody's edit.
  it('do not keep an object the reference repair moved out of a deleted frame', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    link.disconnect();
    const shape = create(ada, newShape('shape-new', 'frame-plan'));
    applyCommand(bob, deleteObjectsCommand, { ids: ['frame-plan'] }, BOB, BOB_ENVIRONMENT);
    link.reconnect();
    expect(mustGet(ada, shape).parentId).toBeNull();

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(ada.get(shape)).toBeUndefined();
    expect(bob.get(shape)).toBeUndefined();
    expectConvergedValidBoards(ada, bob);
  });

  it('do not keep a connector the reference repair detached from a deleted object', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    link.disconnect();
    const input = { from: { objectId: 'image-photo' }, to: { point: { x: 0, y: 0 } } };
    const connector = applyCommand(ada, connectCommand, input).result.id;
    applyCommand(bob, deleteObjectsCommand, { ids: ['image-photo'] }, BOB, BOB_ENVIRONMENT);
    link.reconnect();
    expect(mustGet(ada, connector)).toMatchObject({ from: { kind: 'point' } });

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(ada.get(connector)).toBeUndefined();
    expect(bob.get(connector)).toBeUndefined();
    expectConvergedValidBoards(ada, bob);
  });
  // (c) Ada receives Bob's delete and Bob's repair in one diff and never repairs herself: Bob's
  // repair is still nobody's edit, and Ada's undo removes her shape.
  it("do not keep a shape a peer's repair moved, when this client never repaired it", () => {
    const { ada, bob, link, history } = createClients(order.adaClientId, order.bobClientId);
    link.disconnect();
    const shape = create(ada, newShape('shape-new', 'frame-plan'));
    remove(bob, ['frame-plan'], BOB);
    sendAll(ada, bob); // Bob repairs Ada's shape
    sendAll(bob, ada); // Ada receives the delete and the repair together
    expect(mustGet(ada, shape).parentId).toBeNull();

    expect(history.undo()).toBe(true);
    link.reconnect();
    expect(ada.get(shape)).toBeUndefined();
    expect(bob.get(shape)).toBeUndefined();
    expectConvergedValidBoards(ada, bob);
  });
});
