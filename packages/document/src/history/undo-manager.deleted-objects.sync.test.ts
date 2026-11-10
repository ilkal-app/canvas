import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  BOB_ENVIRONMENT,
  createClients,
  expectConvergedValidBoards,
  moveBy,
  ORDERS,
  remove,
} from './__fixtures__/creation-fixtures.js';
import { ADA_ID, BOB_ID } from './__fixtures__/history-fixtures.js';
import { depthsOf } from './history-depths.js';
import { createHistory } from './undo-manager.js';

// Yjs's `redoItem` follows `item.redone` and reads the struct it finds as an item. An
// undo's copy of a value can be garbage-collected: Bob deletes a shape and undoes the delete
// (Yjs re-creates the shape's map as Bob's copy), a redo step that wrote inside that copy is
// cleared (Yjs then stops keeping the copy, `clearUndoManagerStackItem`), and Ada deletes the
// shape, so Bob's document collects the copy and every value in it. Bob's undo of an older move
// of the shape walks from the old value to the copy and finds a collected struct: Yjs threw a
// `TypeError` part-way through the step, after popping it and restoring the other shape the
// same move had moved. Reduced from the creation guard's property test (seed 20261451, Ada's
// client id 2; also 100064 and 102566).

const SHAPE = 'shape-box';
const SECOND = 'sticky-idea';

/**
 * The whole Yjs state of a store, to tell that a click wrote nothing to the document.
 *
 * @param store - The store.
 * @returns Its state as one update.
 */
function stateOf(store: YjsDocumentStore): Uint8Array {
  return Y.encodeStateAsUpdate(internalsOf(store).doc);
}

describe.each(ORDERS)('an undo whose value leads to a collected copy ($name)', (order) => {
  /**
   * The sequence above, ending with Bob's move of both shapes on top of his stack and an older
   * move of a third object below it.
   *
   * @returns The clients and Bob's history.
   */
  function arrange() {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const history = createHistory(bob, BOB_ID);
    moveBy(bob, 'image-photo', 7); // an older step, for the undo after the refused one
    const moves = [SECOND, SHAPE].map((id) => ({ id, by: { x: 10, y: 0 } }));
    applyCommand(bob, moveObjectsCommand, { moves }, BOB, BOB_ENVIRONMENT);
    remove(bob, [SHAPE], BOB);
    expect(history.undo()).toBe(true); // the shape comes back as Bob's copy
    moveBy(bob, SHAPE, 20);
    expect(history.undo()).toBe(true); // a redo step that wrote inside the copy
    moveBy(bob, 'frame-plan', 5); // clears it: Yjs stops keeping the copy
    link.deliver();
    remove(ada, [SHAPE]);
    link.deliver(); // Bob's document collects the copy and its values
    expect(history.undo()).toBe(true); // the frame's move
    return { ada, bob, link, history };
  }

  it('is used up unapplied: no throw, the document unchanged, only that step gone', () => {
    const { ada, bob, link, history } = arrange();
    const before = stateOf(bob);
    const depths = depthsOf(history);

    expect(history.undo()).toBe(false);
    expect(stateOf(bob)).toEqual(before);
    expect(depthsOf(history)).toEqual({ undo: depths.undo - 1, redo: depths.redo });
    expect(history.lastOmission()).toBeUndefined();
    link.deliver();
    expectConvergedValidBoards(ada, bob);
  });

  it('leaves the steps before it to the next undo', () => {
    const { ada, bob, link, history } = arrange();
    const photo = mustGet(bob, 'image-photo');
    expect(history.undo()).toBe(false);

    expect(history.undo()).toBe(true);
    expect(mustGet(bob, 'image-photo').x).toBe(photo.x - 7);
    expect(history.redo()).toBe(true);
    expect(mustGet(bob, 'image-photo').x).toBe(photo.x);
    link.deliver();
    expectConvergedValidBoards(ada, bob);
  });
});

// Item 2 (the ruling: used up, as now). Bob moves a shape and Ada deletes it: Bob's undo
// of the move writes only inside the deleted shape's map, so Yjs restores nothing and pushes no
// redo step; the step is used up and the app gives its notice. Keeping it on the stack would not
// let it apply later: when Ada's undo brings the shape back, the shape is Ada's copy, and Yjs
// follows a deleted map to its copy only through the re-creation links of the client that made
// the copy, which Bob's document does not have. A kept step would only block the steps below it.
describe.each(ORDERS)('an undo that writes only into an object deleted since ($name)', (order) => {
  it('is used up unapplied, and leaves nothing to redo when the object comes back', () => {
    const { ada, bob, link } = createClients(order.adaClientId, order.bobClientId);
    const adaHistory = createHistory(ada, ADA_ID);
    const history = createHistory(bob, BOB_ID);
    moveBy(bob, SHAPE, 10);
    const moved = mustGet(bob, SHAPE);
    link.deliver();
    remove(ada, [SHAPE]);
    link.deliver();
    const before = stateOf(bob);

    expect(history.undo()).toBe(false);
    expect(stateOf(bob)).toEqual(before);
    expect(depthsOf(history)).toEqual({ undo: 0, redo: 0 });
    expect(adaHistory.undo()).toBe(true); // the shape comes back, as Ada's copy
    link.deliver();
    expect(mustGet(bob, SHAPE)).toEqual(moved);
    expect(history.canRedo()).toBe(false);
    expect(history.canUndo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });
});
