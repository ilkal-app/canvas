import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { validateBoard } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import type { newObjectSchema } from '../commands/new-object-schema.js';
import type { CommandEnvironment } from '../commands/run-command.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { ADA, BOB, BODY, id, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import {
  deleteMember,
  memberValues,
  writeMember,
} from './__fixtures__/member-property-fixtures.js';
import { createHistory } from './undo-manager.js';

// One undo click undoes at most one of the user's steps. When the newest step
// can no longer change anything, because another client overwrote all of it or because the
// field guard keeps every value it would remove, Yjs used to go on to the next step in the same
// click: the user lost a step they never asked to undo. Which of two concurrent writes wins
// depends on the Yjs client ids, so each case runs with Ada's id above and below Bob's.

const ORDERS = [
  { name: "Ada's writes win", adaClientId: 2, bobClientId: 1 },
  { name: "Bob's writes win", adaClientId: 1, bobClientId: 2 },
] as const;

/**
 * A connector with no label, whose label Ada and Bob then set at once: each writes a new label
 * map, and one replaces the other (a label that exists already is edited in place, and both
 * edits would survive).
 */
const CONNECTOR = {
  type: 'connector',
  id: id('connector-unlabelled'),
  parentId: null,
  locked: false,
  x: 0,
  y: 0,
  from: { kind: 'point', x: 0, y: 0 },
  to: { kind: 'point', x: 300, y: 200 },
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  label: null,
} satisfies z.input<typeof newObjectSchema>;

/**
 * A command environment whose clock reads a fixed time.
 *
 * @param time - The command's time, ms since the epoch.
 * @returns The environment.
 */
function environmentAt(time: number): CommandEnvironment {
  return { clock: () => time, createId: () => id(`created-at-${String(time)}`) };
}

/**
 * Moves an object by a delta in x, as Ada or Bob.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param dx - The delta, board units.
 * @param isBob - Whether Bob moves it rather than Ada.
 * @param time - The command's time.
 */
function moveBy(
  store: DocumentStore,
  objectId: string,
  dx: number,
  isBob: boolean,
  time: number,
): void {
  const input = { moves: [{ id: objectId, by: { x: dx, y: 0 } }] };
  applyCommand(store, moveObjectsCommand, input, isBob ? BOB : ADA, environmentAt(time));
}

/**
 * Sets the connector's label, as Ada or Bob.
 *
 * @param store - The store.
 * @param text - The label's text.
 * @param isBob - Whether Bob sets it rather than Ada.
 * @param time - The command's time.
 */
function setLabel(store: DocumentStore, text: string, isBob: boolean, time: number): void {
  const input = { id: CONNECTOR.id, text, runs: [{ length: text.length, style: BODY }] };
  applyCommand(store, setTextRunsCommand, input, isBob ? BOB : ADA, environmentAt(time));
}

/**
 * Checks both peers hold the same readable board, which keeps the board rules.
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectConvergedValidBoards(first: DocumentStore, second: DocumentStore): void {
  expect(unreadableEntries(first)).toEqual([]);
  expect(unreadableEntries(second)).toEqual([]);
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
  expect(validateBoard(first.read())).toEqual([]);
}

describe.each(ORDERS)('one undo click, one step ($name)', ({ adaClientId, bobClientId }) => {
  // Bob overwrote everything Ada's newest step wrote.
  it('uses up a step another client overwrote without undoing the one before it', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const photoBefore = mustGet(ada, 'image-photo');
    moveBy(ada, 'image-photo', 40, false, NOW + 1_000);
    const photoMoved = mustGet(ada, 'image-photo');
    moveBy(ada, 'shape-box', 50, false, NOW + 2_000);
    link.deliver();
    moveBy(bob, 'shape-box', 70, true, NOW + 3_000);
    link.deliver();
    const boxByBob = mustGet(ada, 'shape-box');

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(photoMoved);
    expect(mustGet(ada, 'shape-box')).toEqual(boxByBob);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(photoBefore);
    expect(mustGet(ada, 'shape-box')).toEqual(boxByBob);
    expect(history.canUndo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });

  // Ada's label won the race, so the guard keeps every value undoing it would remove,
  // and Yjs refuses to restore the label before it (Bob's discarded write sits after it). When
  // Bob's won, Ada's values are gone already. Either way the step can change nothing.
  it('uses up a step it can change nothing of without undoing the one before it', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const photoBefore = mustGet(ada, 'image-photo');
    applyCommand(bob, createObjectCommand, { object: CONNECTOR }, BOB, environmentAt(NOW));
    moveBy(ada, 'image-photo', 40, false, NOW + 1_000);
    const photoMoved = mustGet(ada, 'image-photo');
    link.deliver();
    link.disconnect();
    setLabel(ada, 'from Ada', false, NOW + 2_000);
    setLabel(bob, 'from Bob', true, NOW + 3_000);
    link.reconnect();
    const connectorMerged = mustGet(ada, CONNECTOR.id);

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, CONNECTOR.id)).toEqual(connectorMerged);
    expect(mustGet(ada, 'image-photo')).toEqual(photoMoved);
    expect(history.canUndo()).toBe(true);

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(photoBefore);
    expect(mustGet(ada, CONNECTOR.id)).toEqual(connectorMerged);
    expect(history.canUndo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });

  it('uses up a redo step another client overwrote without redoing the one after it', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const photoBefore = mustGet(ada, 'image-photo');
    moveBy(ada, 'image-photo', 40, false, NOW + 1_000);
    const photoMoved = mustGet(ada, 'image-photo');
    moveBy(ada, 'shape-box', 50, false, NOW + 2_000);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    link.deliver();
    // Bob moves the photo after Ada's undo of her move: redoing that move can change nothing.
    moveBy(bob, 'image-photo', 70, true, NOW + 3_000);
    link.deliver();
    const photoByBob = mustGet(ada, 'image-photo');
    expect(photoByBob).not.toEqual(photoBefore);
    expect(photoByBob).not.toEqual(photoMoved);
    const boxBefore = mustGet(ada, 'shape-box');

    expect(history.redo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(photoByBob);
    expect(mustGet(ada, 'shape-box')).toEqual(boxBefore);
    expect(history.canRedo()).toBe(true);

    expect(history.redo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, 'shape-box')).not.toEqual(boxBefore);
    expect(history.canRedo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });

  //'s restore, beside a collaborator: what the dropped redo steps' undos deleted lets a
  // restore pass over the user's own removed write, never over a value another client wrote.
  it('keeps a value another client wrote after a dropped redo step, using the undo up', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    writeMember(ada, ADA, 'p2', 3, 0);
    deleteMember(ada, ADA, 'p2');
    writeMember(ada, ADA, 'p2', 4, 0);
    expect(history.undo()).toBe(true);
    writeMember(ada, ADA, 'p1', 9, 0); // drops the redo stack
    expect(history.undo()).toBe(true);
    link.deliver();
    writeMember(bob, BOB, 'p2', 7, 1);
    link.deliver();

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(memberValues(ada)).toEqual(['p2@7,1']);
    expect(history.canUndo()).toBe(true);
    expect(memberValues(bob)).toEqual(memberValues(ada));
    expectConvergedValidBoards(ada, bob);
  });

  // Yjs closes the capture window only when it pushes an inverse, and a used-up step pushes
  // none: the next edit inside the window would merge into the older step now on top.
  it('starts a new step with the next edit after a used-up step, inside the capture window', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID, { captureTimeout: 60_000 });
    moveBy(ada, 'image-photo', 40, false, NOW + 1_000);
    const photoMoved = mustGet(ada, 'image-photo');
    history.stopCapturing();
    moveBy(ada, 'shape-box', 50, false, NOW + 2_000); // the capture window stays open
    link.deliver();
    moveBy(bob, 'shape-box', 70, true, NOW + 3_000);
    link.deliver();
    const boxByBob = mustGet(ada, 'shape-box');
    expect(history.undo()).toBe(false);

    moveBy(ada, 'shape-box', 5, false, NOW + 4_000);
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, 'shape-box')).toEqual(boxByBob);
    expect(mustGet(ada, 'image-photo')).toEqual(photoMoved);
    expect(history.canUndo()).toBe(true);
    expectConvergedValidBoards(ada, bob);
  });
});
