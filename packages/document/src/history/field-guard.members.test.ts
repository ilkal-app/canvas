import { describe, expect, it } from 'vitest';

import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import {
  addMember,
  deleteEnd,
  expectValidBoard,
  membersOf,
  moveVertex,
  PATH_ID,
} from './__fixtures__/network-member-fixtures.js';
import { createHistory } from './undo-manager.js';

// The field guard kept every map entry with an earlier value in its key's history, so an
// entry that undo or redo itself had re-created could never be removed again: the step changed
// nothing and Yjs silently undid or redid the next one instead. One client, nobody else writing.

/**
 * A store holding the fixture board, with Ada's history.
 *
 * @returns The store and the history.
 */
function alone() {
  const store = createFixtureStore();
  return { store, history: createHistory(store, ADA_ID) };
}

describe('undo and redo of vector network members by one client', () => {
  it('removes an added member again when undoing its redone addition', () => {
    const { store, history } = alone();
    const before = membersOf(store);
    addMember(store);
    const added = membersOf(store);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(membersOf(store)).toEqual(added);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expectValidBoard(store);
  });

  it('removes a deleted member again when redoing its undone deletion', () => {
    const { store, history } = alone();
    const before = membersOf(store);
    deleteEnd(store);
    const deleted = membersOf(store);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(membersOf(store)).toEqual(deleted);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expectValidBoard(store);
  });

  it('returns an overwritten member to its first value after undo, redo and undo', () => {
    const { store, history } = alone();
    const before = membersOf(store);
    moveVertex(store, 'v2', 111);
    const moved = membersOf(store);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(membersOf(store)).toEqual(moved);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(before);
    expectValidBoard(store);
  });

  it('keeps undoing and redoing an addition and a deletion over many rounds', () => {
    const { store, history } = alone();
    const start = membersOf(store);
    addMember(store);
    store.transact(ADA, (transaction) => {
      transaction.deleteSegment(PATH_ID, 's1');
      transaction.deleteVertex(PATH_ID, 'v1');
    });
    const end = membersOf(store);
    for (let round = 0; round < 4; round += 1) {
      expect(history.undo()).toBe(true);
      expect(history.undo()).toBe(true);
      expect(membersOf(store)).toEqual(start);
      expect(history.redo()).toBe(true);
      expect(history.redo()).toBe(true);
      expect(membersOf(store)).toEqual(end);
    }
    expectValidBoard(store);
  });

  it('removes a member re-added under the id of one deleted before', () => {
    const { store, history } = alone();
    addMember(store);
    const added = membersOf(store);
    store.transact(ADA, (transaction) => {
      transaction.deleteSegment(PATH_ID, 's3');
      transaction.deleteVertex(PATH_ID, 'v4');
    });
    const removed = membersOf(store);
    addMember(store);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(removed);
    expect(history.undo()).toBe(true);
    expect(membersOf(store)).toEqual(added);
    expectValidBoard(store);
  });
});
