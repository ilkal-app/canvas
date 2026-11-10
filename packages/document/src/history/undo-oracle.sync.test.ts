import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { connectCommand } from '../commands/connect.js';
import { createObjectCommand } from '../commands/create-object.js';
import { bringToFrontCommand } from '../commands/reorder.js';
import { runCommand } from '../commands/run-command.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { ADA, BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import {
  BOB_ENVIRONMENT,
  create,
  createClients,
  moveBy,
  NEW_FRAME,
  newShape,
  ORDERS,
  remove,
  type NewObject,
} from './__fixtures__/creation-fixtures.js';
import { BOB_ID } from './__fixtures__/history-fixtures.js';
import { ModelledClient, ProductItems, stateOf } from './__fixtures__/undo-oracle.js';
import { CreationGuard } from './creation-guard.js';
import { depthsOf, registerDepths } from './history-depths.js';
import { createHistory, type UndoHistory } from './undo-manager.js';

// Fix round 3: the property test's oracle must catch the losses the creation guard exists to
// prevent, so a guard that fails is reported. These run the oracle against a guard stubbed to
// keep nothing, and against a history that drops a redo step, and check it reports each; and
// they check it still excuses the one repair write the controller ruled is not a loss (a `z`
// the undo's own repair re-keys after a legitimate re-parent, seed 1599).

/**
 * The oracle's model of Bob, with his history, and the product's items of both stores.
 *
 * @param ada - Ada's store.
 * @param bob - Bob's store.
 * @param history - Bob's history; a new one by default.
 * @returns The model and the product's items.
 */
function bobModel(ada: DocumentStore, bob: DocumentStore, history?: UndoHistory) {
  const products = new ProductItems();
  products.watch(ada);
  products.watch(bob);
  return { client: new ModelledClient(bob, history ?? createHistory(bob, BOB_ID)), products };
}

/**
 * Creates an object as Bob, and notes the step in his model.
 *
 * @param client - Bob's model.
 * @param object - The object.
 * @param origin - Bob's origin.
 * @returns The new id.
 * @throws {Error} When the command is refused.
 */
function createAsBob(client: ModelledClient, object: NewObject, origin: TransactionOrigin = BOB) {
  const past = stateOf(client.store);
  const input = { object };
  const outcome = runCommand(client.store, origin, createObjectCommand, input, BOB_ENVIRONMENT);
  if (outcome.status === 'rejected') throw new Error('create refused');
  client.noteStep(past, 'createObject');
  return outcome.result.id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ORDERS)('the oracle, with the creation guard keeping nothing ($name)', (order) => {
  it('reports a shape Ada put into the frame Bob made, which his undo moved out', () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const { client, products } = bobModel(ada, bob);
    const shape = create(ada, newShape('shape-ada'));
    link.deliver();
    const frame = createAsBob(client, NEW_FRAME);
    link.deliver();
    moveBy(ada, shape, 2_000, frame, ADA);
    link.deliver();
    vi.spyOn(CreationGuard.prototype, 'keeps').mockReturnValue(false);

    const lost = client.click('undo', products);
    expect(mustGet(bob, shape).parentId).toBeNull();
    expect(lost.some((value) => value.startsWith('shape-ada.placement'))).toBe(true);
  });

  it('reports a connector end Ada attached to the shape Bob made, which his undo detached', () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const { client, products } = bobModel(ada, bob);
    const shape = createAsBob(client, newShape('shape-bob'));
    link.deliver();
    const input = { from: { objectId: shape }, to: { point: { x: 0, y: 0 } } };
    const connector = applyCommand(ada, connectCommand, input).result.id;
    link.deliver();
    vi.spyOn(CreationGuard.prototype, 'keeps').mockReturnValue(false);

    const lost = client.click('undo', products);
    expect(mustGet(bob, connector)).toMatchObject({ from: { kind: 'point' } });
    expect(lost.some((value) => value.startsWith(`${connector}.from`))).toBe(true);
  });
});

describe.each(ORDERS)('the oracle, with a sound guard ($name)', (order) => {
  // Property seed 1599, reduced: not a loss by the controller's ruling (fix round 3).
  it("does not report the z Bob's undo re-keys after a legitimate re-parent", () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const { client, products } = bobModel(ada, bob);
    const first = createAsBob(client, { ...NEW_FRAME, id: 'frame-first' });
    const second = createAsBob(client, { ...NEW_FRAME, id: 'frame-second', x: 5_000 });
    const shape = createAsBob(client, newShape('shape-bob', first));
    link.deliver();
    const past = stateOf(bob);
    moveBy(bob, shape, 3_000, second);
    client.noteStep(past, 'moveObjects');
    link.deliver();
    remove(ada, [first], ADA);
    applyCommand(ada, bringToFrontCommand, { ids: [shape] });
    link.deliver();

    expect(client.click('undo', products)).toEqual([]);
    expect(mustGet(bob, shape).parentId).toBeNull();
  });

  it('reports a redo step the history dropped', () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const history = createHistory(bob, BOB_ID);
    let isDropping = false;
    const dropping: UndoHistory = Object.create(history) as UndoHistory;
    registerDepths(dropping, () => {
      const { undo, redo } = depthsOf(history);
      return { undo, redo: isDropping ? Math.max(0, redo - 1) : redo };
    });
    const { client, products } = bobModel(ada, bob, dropping);
    createAsBob(client, newShape('shape-bob'));
    link.deliver();
    const undo = history.undo.bind(history);
    vi.spyOn(dropping, 'undo').mockImplementation(() => {
      const isChanged = undo();
      isDropping = true;
      return isChanged;
    });

    expect(() => client.click('undo', products)).toThrow(/redo/);
  });
});
