import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { validateBoard, type TextContent, type TextStyle } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import type { newObjectSchema } from '../commands/new-object-schema.js';
import type { CommandEnvironment } from '../commands/run-command.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { ADA, BOB, BODY, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Undo after concurrent writes must never leave an object without a field (field-guard.ts).
// Which of two concurrent writes to one field wins depends on the Yjs client ids, so each case
// runs with Ada's id above and below Bob's.

const PHOTO = fixtureObject('image-photo', 'image');
const BOB_ENVIRONMENT: CommandEnvironment = {
  clock: () => NOW + 1_000,
  createId: () => id('bob-1'),
};
const ORDERS = [
  { name: "Ada's writes win", adaClientId: 2, bobClientId: 1 },
  { name: "Bob's writes win", adaClientId: 1, bobClientId: 2 },
] as const;
/** When Ada and Bob set the connector's label, after Bob created it (`BOB_ENVIRONMENT`). */
const ADA_LABEL_TIME = NOW + 2_000;
const BOB_LABEL_TIME = NOW + 3_000;
/** When Ada edits the label again, after both. */
const ADA_EDIT_TIME = NOW + 4_000;

/** An object as `createObject` takes it. */
type NewObject = z.input<typeof newObjectSchema>;

/** A connector with no label yet, and a comment pinned to it. */
const UNLABELLED_CONNECTOR = {
  type: 'connector',
  id: id('connector-plain'),
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
} satisfies NewObject;
const PIN_ON_CONNECTOR = {
  type: 'comment',
  id: id('comment-on-connector'),
  parentId: null,
  locked: false,
  x: 40,
  y: 40,
  threadId: 'thread-connector',
  anchor: { kind: 'object', objectId: UNLABELLED_CONNECTOR.id, offset: { x: 10, y: 10 } },
} satisfies NewObject;

/** A bold variant of the body style, for a label edit that restyles every character. */
const BOLD: TextStyle = { ...BODY, weight: 700 };

/**
 * A command environment whose clock reads a fixed time, for a command that runs later than
 * the ones before it (a command writes `updatedAt` only when its time differs).
 *
 * @param time - The command's time, ms since the epoch.
 * @returns The environment.
 */
function environmentAt(time: number): CommandEnvironment {
  return { clock: () => time, createId: () => id(`created-at-${String(time)}`) };
}

/**
 * Sets the plain connector's label.
 *
 * @param store - The store.
 * @param text - The label's text.
 * @param isBob - Whether Bob sets it rather than Ada.
 * @param time - The command's time; by default Ada's frozen clock, or Bob's later one.
 * @param style - The style of every character.
 */
function setLabel(
  store: DocumentStore,
  text: string,
  isBob: boolean,
  time?: number,
  style = BODY,
): void {
  const input = { id: UNLABELLED_CONNECTOR.id, text, runs: [{ length: text.length, style }] };
  const environment = time === undefined ? undefined : environmentAt(time);
  if (isBob) applyCommand(store, setTextRunsCommand, input, BOB, environment ?? BOB_ENVIRONMENT);
  else applyCommand(store, setTextRunsCommand, input, ADA, environment);
}

/**
 * Removes the plain connector's label through the store, as an edit that is not a command.
 *
 * @param store - Ada's store.
 */
function removeLabel(store: DocumentStore): void {
  store.transact(ADA, (transaction) => {
    transaction.patchObject(UNLABELLED_CONNECTOR.id, { label: null });
  });
}

/**
 * Two linked clients with Ada's history, on a board where Bob created the plain connector and a
 * comment pinned to it.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The stores, the link and Ada's history.
 */
function withPinnedConnector(adaClientId: number, bobClientId: number) {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  const link = new Link(ada, bob);
  const history = createHistory(ada, ADA_ID);
  applyCommand(bob, createObjectCommand, { object: UNLABELLED_CONNECTOR }, BOB, BOB_ENVIRONMENT);
  applyCommand(bob, createObjectCommand, { object: PIN_ON_CONNECTOR }, BOB, BOB_ENVIRONMENT);
  link.deliver();
  return { ada, bob, link, history };
}

/**
 * {@link withPinnedConnector}, then Ada and Bob set the connector's label at the same time, each
 * at a later time than the creation, and the link delivers both.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The stores, the link and Ada's history.
 */
function afterLabelRace(adaClientId: number, bobClientId: number) {
  const clients = withPinnedConnector(adaClientId, bobClientId);
  clients.link.disconnect();
  setLabel(clients.ada, 'from Ada', false, ADA_LABEL_TIME);
  setLabel(clients.bob, 'from Bob', true, BOB_LABEL_TIME);
  clients.link.reconnect();
  return clients;
}

/**
 * The plain connector's label.
 *
 * @param store - The store.
 * @returns The label, or `undefined` when the connector cannot be read.
 */
function labelOf(store: DocumentStore): TextContent | null | undefined {
  const connector = mustGet(store, UNLABELLED_CONNECTOR.id);
  return connector.type === 'connector' ? connector.label : undefined;
}

/**
 * Moves the photo by a delta in x.
 *
 * @param store - The store.
 * @param dx - The delta, board units.
 * @param isBob - Whether Bob moves it (with his later clock) rather than Ada.
 */
function movePhoto(store: DocumentStore, dx: number, isBob: boolean): void {
  const input = { moves: [{ id: 'image-photo', by: { x: dx, y: 0 } }] };
  if (isBob) applyCommand(store, moveObjectsCommand, input, BOB, BOB_ENVIRONMENT);
  else applyCommand(store, moveObjectsCommand, input, ADA);
}

/**
 * Checks both peers hold the same board and can read every object in it.
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectConvergedAndReadable(first: DocumentStore, second: DocumentStore): void {
  expect(first.read().issues).toEqual([]);
  expect(second.read().issues).toEqual([]);
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
}

/**
 * {@link expectConvergedAndReadable}, and both boards keep the board rules (a comment
 * pinned to an object nobody can read breaks `missing-comment-anchor`).
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectValidBoards(first: DocumentStore, second: DocumentStore): void {
  expectConvergedAndReadable(first, second);
  expect(validateBoard(first.read())).toEqual([]);
  expect(validateBoard(second.read())).toEqual([]);
}

describe.each(ORDERS)('undo after concurrent writes ($name)', ({ adaClientId, bobClientId }) => {
  it('restores an object whole when its delete raced another client editing it', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['image-photo'] });
    movePhoto(bob, 40, true);
    link.reconnect();
    expect(ada.get(id('image-photo'))).toBeUndefined();
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, 'image-photo')).toEqual(PHOTO);
    expectConvergedAndReadable(ada, bob);
  });

  it('restores a path whole when its delete raced another client moving a vertex', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const path = fixtureObject('path-squiggle', 'path');
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['path-squiggle'] });
    bob.transact(BOB, (transaction) => {
      transaction.setVertex(path.id, { id: 'v2', x: 120, y: 10, mirror: 'both' });
    });
    link.reconnect();
    history.undo();
    link.deliver();
    expect(mustGet(ada, 'path-squiggle')).toEqual(path);
    expectConvergedAndReadable(ada, bob);
  });

  it('restores a labelled shape when its delete raced another client removing the label', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const box = fixtureObject('shape-box', 'shape');
    expect(box.label).not.toBeNull();
    link.disconnect();
    applyCommand(ada, deleteObjectsCommand, { ids: ['shape-box'] });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(box.id, { label: null });
    });
    link.reconnect();
    history.undo();
    link.deliver();
    // The label cannot be rebuilt from the deleted one; Bob's removal is what survives.
    expect(mustGet(ada, 'shape-box')).toEqual({ ...box, label: null });
    expectConvergedAndReadable(ada, bob);
  });

  // The sync fuzz converged on a board whose comment was pinned to a connector nobody
  // could read. Its label, which two clients had set at once, lost its text to an undo.
  it('keeps a label whole when undoing a label another client set at the same time', () => {
    const { ada, bob, link, history } = afterLabelRace(adaClientId, bobClientId);
    const isAdaWinning = adaClientId > bobClientId;
    const merged = mustGet(ada, UNLABELLED_CONNECTOR.id);
    expect(merged).toMatchObject({
      label: { text: isAdaWinning ? 'from Ada' : 'from Bob' },
      updatedAt: isAdaWinning ? ADA_LABEL_TIME : BOB_LABEL_TIME,
    });
    // As for a plain field, undo cannot bring back the values from before Ada's step (no label,
    // the creation time): Bob's concurrent writes, which the merge discarded, sit after them.
    // When Ada's won, her label and time stay, the label whole: the map, and the text and runs
    // inside it. When Bob's won, Ada's are gone already. Either way the step changes nothing,
    // and is consumed.
    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, UNLABELLED_CONNECTOR.id)).toEqual(merged);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expectValidBoards(ada, bob);
  });

  // The first undo re-creates the characters Ada's edit deleted, and Yjs asks the second, of
  // the label set, about those re-created items (it follows `item.redone`).
  it.each([
    { edit: 'part of its text', text: 'from X', style: BODY },
    { edit: 'all of its text and style', text: 'zzz', style: BOLD },
  ])('keeps a label whole when undoing an edit of it ($edit), then its set', (edit) => {
    const { ada, bob, link, history } = afterLabelRace(adaClientId, bobClientId);
    const merged = labelOf(ada);
    setLabel(ada, edit.text, false, ADA_EDIT_TIME, edit.style);
    link.deliver();
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(labelOf(ada)).toEqual(merged);
    // Nothing of the set can be reverted, as in the test above. When Bob's writes won, the
    // first undo re-created his time as Ada's copy, and Yjs let the second undo write the
    // creation time over it; since fix round 1 the history leaves that restore out
    // (`restore-guard.ts`), so the step changes nothing in both orders.
    const isAdaWinning = adaClientId > bobClientId;
    const isChanged = history.undo();
    link.deliver();
    expectValidBoards(ada, bob);
    expect(labelOf(ada)).toEqual(merged);
    expect(mustGet(ada, UNLABELLED_CONNECTOR.id).updatedAt).toBe(
      isAdaWinning ? ADA_LABEL_TIME : BOB_LABEL_TIME,
    );
    expect(isChanged).toBe(false);
  });

  // Likewise, undoing the removal re-creates the label map and its contents, and Yjs asks
  // undoing the set about the re-created items.
  it('keeps a label whole when undoing its removal, then its set', () => {
    const { ada, bob, link, history } = afterLabelRace(adaClientId, bobClientId);
    const merged = labelOf(ada);
    removeLabel(ada);
    link.deliver();
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(labelOf(ada)).toEqual(merged);
    // When Bob's label won, the second undo used to write `null` over its re-created copy; since
    // Fix round 1 the history leaves that restore out, so Bob's label stays.
    const isChanged = history.undo();
    link.deliver();
    expectValidBoards(ada, bob);
    expect(labelOf(ada)).toEqual(merged);
    expect(isChanged).toBe(false);
  });

  // The fuzz's chain: Bob overwrote Ada's newer step, so undoing it changes nothing. Yjs used to
  // undo her label set in the same call; now that click only uses the step up, and the
  // next one reaches the set, which the guard judges against the set's own step. It can change
  // nothing of the set either (as in the first test), so that click uses the set up too.
  it('keeps a label whole when the click after a used-up overwritten step reaches its set', () => {
    const { ada, bob, link, history } = afterLabelRace(adaClientId, bobClientId);
    const merged = labelOf(ada);
    const move = { moves: [{ id: 'image-photo', by: { x: 40, y: 0 } }] };
    applyCommand(ada, moveObjectsCommand, move, ADA, environmentAt(ADA_EDIT_TIME));
    link.deliver();
    applyCommand(bob, moveObjectsCommand, move, BOB, environmentAt(ADA_EDIT_TIME + 1_000));
    link.deliver();
    expect(history.undo()).toBe(false);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(false);
    link.deliver();
    expect(history.canUndo()).toBe(false);
    expectValidBoards(ada, bob);
    expect(labelOf(ada)).toEqual(merged);
  });

  it('keeps a label whole when redoing its removal over a label another client set', () => {
    const { ada, bob, link, history } = withPinnedConnector(adaClientId, bobClientId);
    setLabel(ada, 'from Ada', false, ADA_LABEL_TIME);
    removeLabel(ada);
    link.deliver();
    link.disconnect();
    // Offline, Ada brings her label back while Bob, who sees none, sets his.
    expect(history.undo()).toBe(true);
    setLabel(bob, 'from Bob', true, BOB_LABEL_TIME);
    link.reconnect();
    const merged = labelOf(ada);
    expect(merged?.text).toBe(adaClientId > bobClientId ? 'from Ada' : 'from Bob');
    // Redoing the removal would overwrite Bob's concurrent label, which it never does; when
    // Ada's label won, it stays whole.
    expect(history.redo()).toBe(false);
    link.deliver();
    expectValidBoards(ada, bob);
    expect(labelOf(ada)).toEqual(merged);
  });

  it('keeps a value for every field the undone command and a concurrent one both wrote', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    movePhoto(ada, 40, false);
    movePhoto(bob, 100, true);
    link.reconnect();
    const merged = mustGet(ada, 'image-photo');
    history.undo();
    link.deliver();
    // Undo cannot bring back the write the merge discarded, so the field keeps the merged
    // value: Ada's when hers won (undo changes nothing), Bob's when his did.
    expect(mustGet(ada, 'image-photo')).toEqual(merged);
    expectConvergedAndReadable(ada, bob);
  });
});

describe('undo of label edits by one client', () => {
  it('still reverts each edit of a label it set, the text edit first', () => {
    const [ada] = createClientPair(1, 2);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, createObjectCommand, { object: UNLABELLED_CONNECTOR }, BOB, BOB_ENVIRONMENT);
    setLabel(ada, 'first', false);
    setLabel(ada, 'second', false);
    expect(labelOf(ada)?.text).toBe('second');
    expect(history.undo()).toBe(true);
    expect(labelOf(ada)?.text).toBe('first');
    expect(history.undo()).toBe(true);
    expect(labelOf(ada)).toBeNull();
    expect(ada.read().issues).toEqual([]);
  });
});
