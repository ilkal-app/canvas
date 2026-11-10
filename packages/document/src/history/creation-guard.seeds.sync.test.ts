import { describe, expect, it } from 'vitest';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { bringToFrontCommand } from '../commands/reorder.js';
import { ADA, BOB } from '../store/__fixtures__/store-fixtures.js';

import {
  create,
  createClients,
  expectConvergedValidBoards,
  moveBy,
  NEW_FRAME,
  newShape,
  ORDERS,
  remove,
} from './__fixtures__/creation-fixtures.js';
import { BOB_ID } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Fix round 2: the property test's seeds 1599 and 2088, reduced to two clients and a few steps.
// Seed 1185 is `creation-guard.recreated.sync.test.ts` ("undoing a label set after a delete was
// undone").

describe.each(ORDERS)('property seed 2088, reduced ($name)', (order) => {
  // Bob's undo of his delete of Ada's frame wrote her old frame over the newer frame Bob had
  // since made under the same id, which Ada had moved: Yjs passes the newer entry because Bob's
  // own undo had re-created it, and the frame it replaces held Ada's move.
  it('keeps the newer frame under a reused id that Ada moved, when Bob undoes his delete', () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const bobHistory = createHistory(bob, BOB_ID);
    const frame = create(ada, NEW_FRAME);
    link.deliver();
    remove(bob, [frame], BOB);
    create(bob, NEW_FRAME, BOB);
    remove(bob, [frame], BOB);
    expect(bobHistory.undo()).toBe(true); // Bob's own frame comes back, as his undo's copy
    link.deliver();
    moveBy(ada, frame, 300, undefined, ADA);
    link.deliver();
    const moved = mustGet(bob, frame);

    expect(bobHistory.undo()).toBe(false); // the creation of his frame: Ada moved it since
    expect(bobHistory.undo()).toBe(false); // his delete of Ada's frame: it would replace hers
    link.deliver();
    expect(mustGet(bob, frame)).toEqual(moved);
    expectConvergedValidBoards(ada, bob);
  });
});

describe.each(ORDERS)('property seed 1599, reduced ($name)', (order) => {
  // Not a loss: Bob undoes his move of his shape into another frame; its old frame is gone, so
  // the undo's own reference repair moves it to the root and puts it on top there (a new `z`),
  // which replaces the `z` Ada had given it with bring-to-front in the frame it left. Ada never
  // wrote its placement, so the move is Bob's to undo, and the `z` the repair writes is the
  // product's, the same on every client (fix round 2: the oracle counted it as Bob's).
  it("lets Bob undo his move, and the undo's repair re-keys Ada's z", () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const bobHistory = createHistory(bob, BOB_ID);
    const first = create(bob, { ...NEW_FRAME, id: 'frame-first' }, BOB);
    const second = create(bob, { ...NEW_FRAME, id: 'frame-second', x: 5_000 }, BOB);
    const shape = create(bob, newShape('shape-bob', first), BOB);
    link.deliver();
    moveBy(bob, shape, 3_000, second);
    link.deliver();
    remove(ada, [first], ADA);
    applyCommand(ada, bringToFrontCommand, { ids: [shape] });
    link.deliver();
    const adasZ = mustGet(bob, shape).z;

    expect(bobHistory.undo()).toBe(true);
    link.deliver();
    expect(mustGet(bob, shape)).toMatchObject({ parentId: null });
    expect(mustGet(bob, shape).z).not.toBe(adasZ);
    expectConvergedValidBoards(ada, bob);
  });
});
