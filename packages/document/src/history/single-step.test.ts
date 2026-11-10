import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { membersOf, PATH_ID } from './__fixtures__/network-member-fixtures.js';
import { SingleStep } from './single-step.js';
import { createHistory } from './undo-manager.js';

// One client, ids reused after a delete. An undo removed one of the user's own later
// writes of a key, and a new edit then cleared the redo stack that recorded that undo. Yjs will
// not restore an earlier value over a later one unless a live stack deleted it
// (`isDeletedByUndoStack` in its `redoItem`), so it refused, and went on to undo the next step,
// and the next, in the same click.

/**
 * Writes vertex `key` of the fixture path at `x`, as Ada (a vertex no segment joins).
 *
 * @param store - The store.
 * @param key - The vertex id.
 * @param x - Its x, path units.
 */
function setMember(store: DocumentStore, key: string, x: number): void {
  store.transact(ADA, (transaction) => {
    transaction.setVertex(PATH_ID, { id: key, x, y: 0, mirror: 'none' });
  });
}

/**
 * Deletes vertex `key` of the fixture path, as Ada.
 *
 * @param store - The store.
 * @param key - The vertex id.
 */
function deleteMember(store: DocumentStore, key: string): void {
  store.transact(ADA, (transaction) => {
    transaction.deleteVertex(PATH_ID, key);
  });
}

/**
 * The value of vertex `key` as stored, or `undefined` when the key has none.
 *
 * @param store - The store.
 * @param key - The vertex id.
 * @returns `key@x,y`.
 */
function memberOf(store: DocumentStore, key: string): string | undefined {
  return membersOf(store).find((line) => line.startsWith(`${key}@`));
}

/**
 * Ada's steps A (add p2 at 1), B (p2 from 1 to 3) and C (delete p2), with the redo stack that
 * recorded her undo of a later write of p2 (p2 at 4) cleared by a new edit, and every later step
 * undone, so C is the newest step.
 *
 * @returns The store and Ada's history.
 */
function afterClearedRedo() {
  const store = createFixtureStore();
  const history = createHistory(store, ADA_ID);
  setMember(store, 'p2', 1); // step A
  deleteMember(store, 'p2');
  expect(history.undo()).toBe(true);
  setMember(store, 'p2', 2); // clears the redo stack
  expect(history.undo()).toBe(true);
  setMember(store, 'p2', 3); // step B: p2 from 1 to 3
  deleteMember(store, 'p2'); // step C
  setMember(store, 'p2', 4);
  // Removes the user's own later write, p2@4; the next edit clears the redo stack.
  expect(history.undo()).toBe(true);
  setMember(store, 'p1', 9);
  expect(history.undo()).toBe(true);
  expect(memberOf(store, 'p2')).toBeUndefined();
  return { store, history };
}

describe('one undo click, one step, after the redo stack was cleared', () => {
  it('undoes at most the newest step when an earlier undo removed a later write of its key', () => {
    const { history } = afterClearedRedo();
    history.undo();
    expect(history.canUndo()).toBe(true);
  });

  it('restores a value over a later write of its key an earlier undo removed', () => {
    const { store, history } = afterClearedRedo();
    // Undoes step C only: p2 comes back as step C found it.
    expect(history.undo()).toBe(true);
    expect(memberOf(store, 'p2')).toBe('p2@3,0');
    expect(history.canUndo()).toBe(true);
    // Then step B, then step A.
    expect(history.undo()).toBe(true);
    expect(memberOf(store, 'p2')).toBe('p2@1,0');
    expect(history.undo()).toBe(true);
    expect(memberOf(store, 'p2')).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    // And each redo reapplies one step.
    expect(history.redo()).toBe(true);
    expect(memberOf(store, 'p2')).toBe('p2@1,0');
    expect(history.redo()).toBe(true);
    expect(memberOf(store, 'p2')).toBe('p2@3,0');
    expect(history.redo()).toBe(true);
    expect(memberOf(store, 'p2')).toBeUndefined();
    // Last, the undone addition of p1.
    expect(history.redo()).toBe(true);
    expect(memberOf(store, 'p1')).toBe('p1@9,0');
    expect(history.canRedo()).toBe(false);
  });
});

/**
 * A bare Yjs document with an undo manager and two steps, `a` then `b`, whose newest step
 * another document has since overwritten, so undoing it can change nothing.
 *
 * @returns The map, the manager and the steps as they were pushed.
 */
function withOverwrittenNewestStep() {
  const doc = new Y.Doc();
  const map = doc.getMap('m');
  const manager = new Y.UndoManager(map, { captureTimeout: 0 });
  map.set('a', 1);
  map.set('b', 1);
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  other.getMap('m').set('b', 2);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), 'remote');
  return { map, manager, steps: [...manager.undoStack] };
}

// The gate for a Yjs upgrade: `SingleStep` relies on how `Y.UndoManager` pops (it loops while
// the array it was handed is not empty, and pops with that array's `pop()`).
describe('SingleStep over a bare Y.UndoManager', () => {
  it('shows Yjs popping through a step that changes nothing, which SingleStep prevents', () => {
    const { map, manager } = withOverwrittenNewestStep();
    expect(manager.undo()).not.toBeNull();
    expect(map.has('a')).toBe(false);
    expect(manager.undoStack).toHaveLength(0);
  });

  it('uses up only the newest step when it changes nothing', () => {
    const { map, manager, steps } = withOverwrittenNewestStep();
    const singleStep = new SingleStep();
    expect(singleStep.apply(manager, 'undo')).toBeNull();
    expect(manager.undoStack).toEqual([steps[0]]);
    expect(map.toJSON()).toEqual({ a: 1, b: 2 });
    expect(singleStep.apply(manager, 'undo')).toBe(steps[0]);
    expect(map.toJSON()).toEqual({ b: 2 });
    expect(manager.undoStack).toHaveLength(0);
    expect(manager.redoStack).toHaveLength(1);
    expect(singleStep.apply(manager, 'undo')).toBeNull();
  });

  it('names the step being applied only while Yjs applies it', () => {
    const { manager, steps } = withOverwrittenNewestStep();
    const singleStep = new SingleStep();
    const seen: (Y.UndoManager['undoStack'][number] | undefined)[] = [];
    manager.deleteFilter = () => {
      seen.push(singleStep.current());
      return true;
    };
    manager.undoStack.pop();
    singleStep.apply(manager, 'undo');
    expect(seen).toEqual([steps[0]]);
    expect(singleStep.current()).toBeUndefined();
  });
});
