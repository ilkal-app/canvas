// Acceptance (comments), "Done means" item 2, written from the ticket
// before the code: "Each thread's pin is a `comment` object in the document (schema exists),
// written through the command layer; it follows its object and becomes a point pin when the
// object is deleted (reference repair). The canvas undo never removes a thread."
//
// The comment object type, its repair on delete and the undo's reference repair exist on main, so
// most of these pass there already: they pin the behaviour the comments feature relies on, so an
// implementation that adds pin commands (`packages/document/src/commands/`, "if needed") keeps it.
//
// CONTRACT: a pin is written with the existing `createObjectCommand` (a `comment` object with the
// thread's `threadId`); no new command is required. Threads are not in the document, so "the
// canvas undo never removes a thread" is asserted here as: no undo or redo of a canvas step
// removes a pin another person placed or changes its `threadId`, and an undo of a deletion leaves
// the pin on the board with its thread.
//
// Deliberately not asserted: whether a user's own undo of placing a pin removes that pin (the
// ticket does not say; the thread itself is relational and untouched either way), whether an
// undo of a deletion re-pins a detached pin to the restored object or leaves it a point pin (the
// existing repair decides), and that a canvas undo issues no boards-service call: the document
// package has no seam to the boards service (it imports no network code), so there is no call to
// observe at this level.
import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  objectToBoardTransform,
  type Board,
  type CommentObject,
  type ObjectId,
} from '@canvas/schema';

import { ADA_ID, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, BOB, BODY } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';

/** The thread every pin here belongs to, as the boards service would name it. */
const THREAD = 'thread_Ab3-xyz';

/**
 * Writes a sticky at (100, 200), 160 square, through the command layer.
 *
 * @param store - The store.
 * @param id - Its id.
 * @returns Its id.
 */
function placeSticky(store: DocumentStore, id = 'note'): ObjectId {
  const { result } = applyCommand(store, createObjectCommand, {
    object: {
      type: 'sticky',
      id,
      x: 100,
      y: 200,
      width: 160,
      height: 160,
      text: 'Hi',
      runs: [{ length: 2, style: BODY }],
      align: 'center',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 0.92, 0.55, 1],
    },
  });
  return result.id;
}

/**
 * Places a thread's pin on an object at an offset in its frame, through the command layer.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param origin - Who places it; Ada by default.
 * @param seed - The id generator's seed (give each client its own).
 * @returns The pin's id.
 */
function pinOn(store: DocumentStore, objectId: ObjectId, origin = ADA, seed = 7): ObjectId {
  const { result } = applyCommand(
    store,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        x: 0,
        y: 0,
        threadId: THREAD,
        anchor: { kind: 'object', objectId, offset: { x: 30, y: 40 } },
      },
    },
    origin,
    testEnvironment(seed),
  );
  return result.id;
}

/**
 * Reads a comment object, failing the test when it is missing or of another type.
 *
 * @param board - The board.
 * @param id - The pin.
 * @returns The comment.
 * @throws {Error} When there is no such comment.
 */
function commentOf(board: Board, id: ObjectId): CommentObject {
  const object = board.objects.get(id);
  if (object?.type !== 'comment') throw new Error(`no comment ${id}`);
  return object;
}

/**
 * Where a pin is drawn on the board: at its anchor object's offset, in that object's frame, or at
 * its own `x`, `y` once it is a point pin (the schema's rule; its helper is not exported).
 *
 * @param board - The board.
 * @param comment - The pin.
 * @returns The point in board coordinates.
 * @throws {Error} When the pin's object is missing.
 */
function commentPinPoint(board: Board, comment: CommentObject): { x: number; y: number } {
  if (comment.anchor.kind === 'point') return { x: comment.x, y: comment.y };
  const target = board.objects.get(comment.anchor.objectId);
  if (target === undefined) throw new Error('the pin`s object is missing');
  return applyTransform(objectToBoardTransform(board, target), comment.anchor.offset);
}

describe('a thread`s pin in the document (item 2)', () => {
  it('is a comment object carrying its thread id, written through the command layer', () => {
    const store = new YjsDocumentStore();
    const note = placeSticky(store);
    const pin = pinOn(store, note);
    expect(commentOf(store.read(), pin)).toMatchObject({
      type: 'comment',
      threadId: THREAD,
      anchor: { kind: 'object', objectId: note },
    });
  });

  it('follows its object when the object moves', () => {
    const store = new YjsDocumentStore();
    const note = placeSticky(store);
    const pin = pinOn(store, note);
    const before = commentPinPoint(store.read(), commentOf(store.read(), pin));
    applyCommand(store, moveObjectsCommand, { moves: [{ id: note, by: { x: 250, y: -75 } }] });
    const after = commentPinPoint(store.read(), commentOf(store.read(), pin));
    expect(after.x - before.x).toBeCloseTo(250);
    expect(after.y - before.y).toBeCloseTo(-75);
  });

  it('becomes a point pin where it was when its object is deleted, keeping its thread', () => {
    const store = new YjsDocumentStore();
    const note = placeSticky(store);
    const pin = pinOn(store, note);
    applyCommand(store, moveObjectsCommand, { moves: [{ id: note, by: { x: 40, y: 10 } }] });
    const where = commentPinPoint(store.read(), commentOf(store.read(), pin));
    applyCommand(store, deleteObjectsCommand, { ids: [note] });
    const board = store.read();
    expect(board.objects.has(note)).toBe(false);
    const detached = commentOf(board, pin);
    expect(detached.anchor).toEqual({ kind: 'point' });
    expect(detached.threadId).toBe(THREAD);
    expect(detached.x).toBeCloseTo(where.x);
    expect(detached.y).toBeCloseTo(where.y);
  });

  it('stays on the board with its thread through an undo and a redo of the deletion', () => {
    const store = new YjsDocumentStore();
    const note = placeSticky(store);
    const pin = pinOn(store, note);
    const history = createHistory(store, ADA_ID);
    applyCommand(store, deleteObjectsCommand, { ids: [note] });

    expect(history.undo()).toBe(true);
    expect(store.read().objects.has(note)).toBe(true);
    expect(commentOf(store.read(), pin).threadId).toBe(THREAD);

    expect(history.redo()).toBe(true);
    expect(store.read().objects.has(note)).toBe(false);
    expect(commentOf(store.read(), pin)).toMatchObject({
      threadId: THREAD,
      anchor: { kind: 'point' },
    });
  });

  it('is never removed by another person`s undo of the object it is pinned on', () => {
    const ada = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    const link = new Link(ada, bob);
    const adaHistory = createHistory(ada, ADA_ID);
    const note = placeSticky(ada);
    link.deliver();
    // Bob pins a thread on Ada's sticky; Ada then undoes making the sticky.
    const pin = pinOn(bob, note, BOB, 23);
    link.deliver();
    adaHistory.undo();
    link.deliver();

    for (const store of [ada, bob]) {
      const comment = commentOf(store.read(), pin);
      expect(comment.threadId).toBe(THREAD);
      // Pinned to the sticky when the undo kept it, or a point pin when it removed it.
      if (store.read().objects.has(note)) {
        expect(comment.anchor).toMatchObject({ kind: 'object', objectId: note });
      } else {
        expect(comment.anchor).toEqual({ kind: 'point' });
      }
    }
  });

  it('is never removed or re-threaded by another person`s undo and redo of a move', () => {
    const ada = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    const link = new Link(ada, bob);
    const note = placeSticky(ada);
    link.deliver();
    const pin = pinOn(bob, note, BOB, 23);
    link.deliver();
    const adaHistory = createHistory(ada, ADA_ID);
    applyCommand(ada, moveObjectsCommand, { moves: [{ id: note, by: { x: 500, y: 0 } }] });
    link.deliver();
    const moved = commentPinPoint(bob.read(), commentOf(bob.read(), pin));

    expect(adaHistory.undo()).toBe(true);
    link.deliver();
    const back = commentPinPoint(bob.read(), commentOf(bob.read(), pin));
    expect(moved.x - back.x).toBeCloseTo(500);
    expect(adaHistory.redo()).toBe(true);
    link.deliver();

    // Nothing of Ada's undo or redo touched Bob's pin.
    expect(commentOf(bob.read(), pin)).toMatchObject({
      threadId: THREAD,
      anchor: { kind: 'object', objectId: note },
    });
    expect(commentOf(ada.read(), pin).threadId).toBe(THREAD);
  });
});
