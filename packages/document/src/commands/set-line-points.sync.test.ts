import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  objectToBoardTransform,
  validateBoard,
  type LineObject,
  type Point,
} from '@canvas/schema';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { storeLineUnsplit } from '../store/__fixtures__/remote-keys.js';
import { BOB, exchange, id } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet, NOW } from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { moveObjectsCommand } from './move-objects.js';
import type { CommandEnvironment } from './run-command.js';
import { setLinePointsCommand } from './set-line-points.js';
import { setLockedCommand } from './set-locked.js';
import { setStyleCommand } from './set-style.js';

// Sync tests for `setLinePoints` on the grouped board: each end of
// a line is its own key in the grouped layout, so an end drag merges with a concurrent restyle
// (the `style` group) or move (the `placement` group) of the same line, and two concurrent drags
// of the same end keep one client's end. On the fixture board, with fixed Yjs client ids so
// both merge orders run: drags of different ends keep both, a drag keeps a collaborator's move,
// undo of an end leaves the other end alone, and a board stored before the split (the whole pair
// under `points`) takes one end from each client.

/**
 * Two stores holding the grouped board, as two synced clients would.
 *
 * @returns Ada's store and Bob's.
 */
function createPair(): [YjsDocumentStore, YjsDocumentStore] {
  const ada = createGroupedStore();
  const bob = new YjsDocumentStore();
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * Checks that both clients hold the same, valid board.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
}

/**
 * A line of a store.
 *
 * @param store - The store.
 * @param id - The line.
 * @returns The line.
 * @throws {Error} When the object is not a line.
 */
function lineOf(store: DocumentStore, id: string): LineObject {
  const object = mustGet(store, id);
  if (object.type !== 'line') throw new Error(`"${id}" is not a line`);
  return object;
}

const ADA_END = { id: 'line-l', end: 1, point: { x: 260, y: 330 } } as const;
const BOB_END = { id: 'line-l', end: 1, point: { x: 400, y: 280 } } as const;

describe('concurrent drags of the same end', () => {
  it('keep one client’s end, the same on both', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, setLinePointsCommand, ADA_END);
    const adaPoints = lineOf(ada, 'line-l').points;
    applyCommand(bob, setLinePointsCommand, BOB_END, BOB);
    const bobPoints = lineOf(bob, 'line-l').points;
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect([adaPoints, bobPoints]).toContainEqual(lineOf(ada, 'line-l').points);
  });
});

describe('an endpoint drag with a concurrent edit of the same line', () => {
  it('merges with a restyle: the new points and the new caps and stroke', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, setLinePointsCommand, ADA_END);
    const dragged = lineOf(ada, 'line-l').points;
    applyCommand(
      bob,
      setStyleCommand,
      {
        changes: [
          {
            id: 'line-l',
            style: {
              endCap: 'triangle',
              route: 'elbow',
              stroke: { color: [1, 0, 0, 1], width: 6 },
            },
          },
        ],
      },
      BOB,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    const line = lineOf(ada, 'line-l');
    expect(line.points).toEqual(dragged);
    expect(line).toMatchObject({ endCap: 'triangle', route: 'elbow', stroke: { width: 6 } });
  });

  it('merges with a move: the line keeps its new points and moves by the delta', () => {
    const [ada, bob] = createPair();
    const origin = lineOf(ada, 'line-m');
    applyCommand(ada, setLinePointsCommand, { ...ADA_END, id: 'line-m' });
    const dragged = lineOf(ada, 'line-m').points;
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: 'line-m', by: { x: 25, y: -5 } }] }, BOB);
    const moved = lineOf(bob, 'line-m');
    exchange(ada, bob);
    expectConverged(ada, bob);
    const line = lineOf(ada, 'line-m');
    expect(line.points).toEqual(dragged);
    expect({ x: line.x, y: line.y }).toEqual({ x: moved.x, y: moved.y });
    expect({ x: line.x, y: line.y }).not.toEqual({ x: origin.x, y: origin.y });
  });

  it('keeps a drag made before a concurrent lock arrived, and the lock with it', () => {
    const [ada, bob] = createPair();
    applyCommand(ada, setLockedCommand, { ids: ['line-l'], locked: true });
    applyCommand(bob, setLinePointsCommand, BOB_END, BOB);
    const dragged = lineOf(bob, 'line-l').points;
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(lineOf(ada, 'line-l')).toMatchObject({ locked: true, points: dragged });
  });
});

const ORDERS = [
  { name: "Ada's writes win", adaClientId: 2, bobClientId: 1 },
  { name: "Bob's writes win", adaClientId: 1, bobClientId: 2 },
] as const;

/** The fixture board's line: from (-400, 700) to (800, 700) on the board, at the root. */
const DIVIDER = 'line-divider';
/** Bob's commands run later than Ada's, so each writes its own stamp. */
const BOB_ENVIRONMENT: CommandEnvironment = {
  clock: () => NOW + 1_000,
  createId: () => id('bob-1'),
};

/**
 * The divider's two ends in board coordinates.
 *
 * @param store - The store.
 * @returns Its start and end.
 */
function endsOf(store: DocumentStore): Point[] {
  const line = lineOf(store, DIVIDER);
  const toBoard = objectToBoardTransform(store.read(), line);
  return line.points.map((point) => applyTransform(toBoard, point));
}

/**
 * Checks that both clients hold the same board, every object readable and every rule kept.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectValidBoards(ada: DocumentStore, bob: DocumentStore): void {
  expect(ada.read().issues).toEqual([]);
  expect(bob.read().issues).toEqual([]);
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(validateBoard(ada.read())).toEqual([]);
  expect(validateBoard(bob.read())).toEqual([]);
}

/**
 * Moves one end of the divider.
 *
 * @param store - The client's store.
 * @param end - Which end.
 * @param point - Where to, board coordinates.
 * @param isBob - Whether Bob moves it (with his later clock) rather than Ada.
 */
function dragEnd(store: DocumentStore, end: 0 | 1, point: Point, isBob = false): void {
  const input = { id: DIVIDER, end, point };
  if (isBob) applyCommand(store, setLinePointsCommand, input, BOB, BOB_ENVIRONMENT);
  else applyCommand(store, setLinePointsCommand, input);
}

const ADA_START = { x: -300, y: 650 };
const BOB_FINISH = { x: 900, y: 800 };

describe.each(ORDERS)('drags of a line’s ends ($name)', ({ adaClientId, bobClientId }) => {
  it('keeps both when Ada drags the start while Bob drags the end', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    dragEnd(ada, 0, ADA_START);
    dragEnd(bob, 1, BOB_FINISH, true);
    exchange(ada, bob);
    expectValidBoards(ada, bob);
    expect(endsOf(ada)).toEqual([ADA_START, BOB_FINISH]);
  });

  it('keeps Bob’s move of the line, and Ada’s end where she put it on the line', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const [start] = endsOf(ada);
    dragEnd(ada, 1, BOB_FINISH);
    const dragged = lineOf(ada, DIVIDER).points[1];
    const move = { moves: [{ id: DIVIDER, by: { x: 200, y: 0 } }] };
    applyCommand(bob, moveObjectsCommand, move, BOB, BOB_ENVIRONMENT);
    exchange(ada, bob);
    expectValidBoards(ada, bob);
    const line = lineOf(ada, DIVIDER);
    expect({ x: line.x, y: line.y }).toEqual({ x: -200, y: 700 });
    expect(line.points[1]).toEqual(dragged);
    expect(endsOf(ada)).toEqual([
      { x: (start?.x ?? 0) + 200, y: start?.y },
      { x: 1100, y: 800 },
    ]);
  });

  it('keeps Bob’s move and puts Ada’s end at her point when the move reached her first', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const [start] = endsOf(ada);
    const move = { moves: [{ id: DIVIDER, by: { x: 200, y: 0 } }] };
    applyCommand(bob, moveObjectsCommand, move, BOB, BOB_ENVIRONMENT);
    exchange(ada, bob);
    dragEnd(ada, 1, BOB_FINISH);
    exchange(ada, bob);
    expectValidBoards(ada, bob);
    expect(endsOf(bob)).toEqual([{ x: (start?.x ?? 0) + 200, y: start?.y }, BOB_FINISH]);
  });

  it('keeps a line both of whose ends were moved onto one point at once, with no length', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const meeting = { x: 200, y: 650 };
    dragEnd(ada, 0, meeting);
    dragEnd(bob, 1, meeting, true);
    exchange(ada, bob);
    // Each command saw a line with length; the merge has none. It stays (no repair deletes it),
    // valid, and draws as a dot whose handles pull it apart again.
    expectValidBoards(ada, bob);
    expect(endsOf(ada)).toEqual([meeting, meeting]);
    dragEnd(ada, 1, { x: 260, y: 650 });
    exchange(ada, bob);
    expect(endsOf(bob)).toEqual([meeting, { x: 260, y: 650 }]);
  });

  it('undoes Ada’s drag of the start after Bob dragged the end: the line stays', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const [start] = endsOf(ada);
    dragEnd(ada, 0, ADA_START);
    link.deliver();
    dragEnd(bob, 1, BOB_FINISH, true);
    link.deliver();
    expect(history.undo()).toBe(true);
    link.deliver();
    expectValidBoards(ada, bob);
    expect(endsOf(ada)).toEqual([start, BOB_FINISH]);
    expect(endsOf(bob)).toEqual([start, BOB_FINISH]);
  });
});

describe.each(ORDERS)('a line stored before its ends had a key each ($name)', (order) => {
  /**
   * Two synced clients whose divider is stored the old way, the whole pair under `points`.
   *
   * @returns Ada's store and Bob's.
   */
  function unsplitPair(): [YjsDocumentStore, YjsDocumentStore] {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    storeLineUnsplit(ada, DIVIDER);
    exchange(ada, bob);
    return [ada, bob];
  }

  it('reads as it was, and keeps one end from each client', () => {
    const [ada, bob] = unsplitPair();
    const before = endsOf(bob);
    expect(before).toEqual([
      { x: -400, y: 700 },
      { x: 800, y: 700 },
    ]);
    dragEnd(ada, 0, ADA_START);
    dragEnd(bob, 1, BOB_FINISH, true);
    exchange(ada, bob);
    expectValidBoards(ada, bob);
    expect(endsOf(ada)).toEqual([ADA_START, BOB_FINISH]);
  });

  /**
   * On an old-layout line, drags the start, undoes, redoes and undoes again.
   *
   * @returns The ends before the drag, what each undo and redo reported, and the ends after.
   */
  function undoRedoUndo() {
    const [ada] = unsplitPair();
    const history = createHistory(ada, ADA_ID);
    const before = endsOf(ada);
    dragEnd(ada, 0, ADA_START);
    const didFirstUndo = history.undo();
    const undone = endsOf(ada);
    const didRedo = history.redo();
    const redone = endsOf(ada);
    const didSecondUndo = history.undo();
    return { before, didFirstUndo, undone, didRedo, redone, didSecondUndo, after: endsOf(ada) };
  }

  it('undoes, redoes and undoes again the first drag of an end', () => {
    const run = undoRedoUndo();
    expect(run.didFirstUndo).toBe(true);
    expect(run.undone).toEqual(run.before);
    expect(run.didRedo).toBe(true);
    expect(run.redone).toEqual([ADA_START, run.before[1]]);
    expect(run.didSecondUndo).toBe(true);
  });

  // Before the undo guard kept a key that undo or redo had re-created, so the second
  // undo reported a step undone but left the end where the redo put it.
  it('returns the end to where it was after the second undo', () => {
    const run = undoRedoUndo();
    expect(run.after).toEqual(run.before);
  });

  it('undoes the first drag of an end back to the stored pair', () => {
    const [ada, bob] = unsplitPair();
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const before = endsOf(ada);
    dragEnd(ada, 0, ADA_START);
    link.deliver();
    dragEnd(bob, 1, BOB_FINISH, true);
    link.deliver();
    expect(history.undo()).toBe(true);
    link.deliver();
    expectValidBoards(ada, bob);
    expect(endsOf(bob)).toEqual([before[0], BOB_FINISH]);
  });
});
