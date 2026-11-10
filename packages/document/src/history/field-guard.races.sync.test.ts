import { describe, expect, it } from 'vitest';

import type { Segment } from '@canvas/schema';

import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { ADA, BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import {
  addMember,
  ADDED_VERTEX,
  deleteEnd,
  expectValidBoard,
  membersOf,
  moveVertex,
  PATH_ID,
  pathOf,
} from './__fixtures__/network-member-fixtures.js';
import { createHistory } from './undo-manager.js';

// Fix round 1: a collaborator's write that raced an EARLIER copy of a value (one an
// earlier undo or redo made) lost to that copy, and the value lives on in the later copies.
// Undo must keep the value then, as it keeps one that raced the current copy (field-guard case
// 1), or the key is left without a value and a segment the collaborator attached to the vertex
// points at nothing.

/** A segment Bob attaches to v4, from v1 (v3–v4 is Ada's s3). */
const BOBS_SEGMENT: Segment = {
  id: 's9',
  a: 'v1',
  b: 'v4',
  ha: { x: 0, y: 0 },
  hb: { x: 0, y: 0 },
};

/**
 * Bob writes v4 at an x of his own and attaches his segment to it, in one step.
 *
 * @param store - Bob's store.
 * @param x - v4's x.
 */
function bobWritesVertex(store: DocumentStore, x: number): void {
  store.transact(BOB, (transaction) => {
    transaction.setVertex(PATH_ID, { ...ADDED_VERTEX, x });
    transaction.setSegment(PATH_ID, BOBS_SEGMENT);
  });
}

/**
 * v4's x in a store.
 *
 * @param store - The store.
 * @returns The x, or `undefined` when v4 is missing.
 */
function vertexX(store: DocumentStore): number | undefined {
  return pathOf(store).vertices.find((vertex) => vertex.id === 'v4')?.x;
}

/**
 * Checks both clients hold the same valid board, with v4 present at an x and Bob's segment.
 *
 * @param ada - Ada's store.
 * @param bob - Bob's store.
 * @param x - v4's x.
 */
function expectVertexKept(ada: DocumentStore, bob: DocumentStore, x: number): void {
  for (const store of [ada, bob]) {
    expectValidBoard(store);
    expect(vertexX(store)).toBe(x);
    expect(membersOf(store)).toContain('s9:v1-v4');
    expect(membersOf(store)).not.toContain('s3:v3-v4');
  }
  expect(new Map(ada.read().objects)).toEqual(new Map(bob.read().objects));
}

describe.each(ORDERS)('undo of a value whose earlier copy won a race ($name)', (order) => {
  const isAdaWinning = order.adaClientId > order.bobClientId;

  // Ada's v4 synced; offline, Ada undoes and redoes its addition `cycles` times while Bob moves
  // v4 and attaches a segment to it. Bob's move raced Ada's first copy. When Ada's copy won,
  // v4 stays where Ada put it (Bob's move was lost to the merge, not to the undo); when Bob's
  // won, his. Either way Ada's undo removes her segment, and the step is used up.
  it.each([0, 1, 2, 3])('keeps v4 after %i undo and redo cycles raced a move', (cycles) => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    addMember(ada);
    link.deliver();
    link.disconnect();
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      history.undo();
      history.redo();
    }
    bobWritesVertex(bob, 777);
    link.reconnect();
    const merged = cycles > 0 && isAdaWinning ? ADDED_VERTEX.x : 777;
    expect(vertexX(ada)).toBe(merged);
    expect(history.undo()).toBe(true);
    link.deliver();
    expectVertexKept(ada, bob, merged);
    expect(history.canUndo()).toBe(false);
  });

  // Offline, Ada adds v4, undoes and redoes it, while Bob adds his own v4 and a segment to it.
  // The two adds raced; whichever won stays, with Bob's segment attached.
  it('keeps v4 when undoing a redone addition that raced the same addition', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    addMember(ada);
    history.undo();
    history.redo();
    bobWritesVertex(bob, 500);
    link.reconnect();
    const merged = isAdaWinning ? ADDED_VERTEX.x : 500;
    expect(vertexX(ada)).toBe(merged);
    expect(history.undo()).toBe(true);
    link.deliver();
    expectVertexKept(ada, bob, merged);
  });
});

// Fix round 2: a race the step being redone already knew about must not protect anything. Ada
// and Bob move v3 at once and the merge keeps one move; afterwards Ada deletes the path's end,
// with the merged v3 in view. Round 1 judged the redo of that delete against the old race (it
// followed v3's copies back to the raced write), kept v3 and removed only s2, every time.
describe.each(ORDERS)('undo and redo after an older race on the member ($name)', (order) => {
  it('redoes a delete made after the race whole, however often', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    moveVertex(ada, 'v3', 111);
    moveVertex(bob, 'v3', 222, BOB);
    link.reconnect();
    const merged = membersOf(ada);
    expect(merged).toContain(order.adaClientId > order.bobClientId ? 'v3@111,50' : 'v3@222,50');
    deleteEnd(ada);
    link.deliver();
    const deleted = merged.filter((member) => !member.startsWith('v3@') && member !== 's2:v2-v3');
    const expectBoth = (members: readonly string[]): void => {
      for (const store of [ada, bob]) {
        expectValidBoard(store);
        expect(membersOf(store)).toEqual(members);
      }
    };
    expectBoth(deleted);
    for (let round = 0; round < 2; round += 1) {
      expect(history.undo()).toBe(true);
      link.deliver();
      expectBoth(merged);
      expect(history.redo()).toBe(true);
      link.deliver();
      expectBoth(deleted);
    }
    expect(history.canRedo()).toBe(false);
  });
});

// Fix round 2: a delete leaves no value, so it protects none. Offline, Ada undoes and redoes her
// synced v4 (her copies are new items) while Bob deletes v4 and Ada's segment (the items he
// saw). Ada's copies survive the merge; her undo then removes them, as Bob wanted too.
describe.each(ORDERS)('undo after a concurrent delete of the member ($name)', (order) => {
  it('removes the member: the delete does not protect it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const before = membersOf(ada);
    addMember(ada);
    link.deliver();
    link.disconnect();
    history.undo();
    history.redo();
    bob.transact(BOB, (transaction) => {
      transaction.deleteSegment(PATH_ID, 's3');
      transaction.deleteVertex(PATH_ID, 'v4');
    });
    link.reconnect();
    expect(membersOf(ada)).toEqual([...before, 's3:v3-v4', 'v4@300,0'].sort());
    expect(history.undo()).toBe(true);
    link.deliver();
    for (const store of [ada, bob]) {
      expectValidBoard(store);
      expect(membersOf(store)).toEqual(before);
    }
  });
});

// Q2c, a known limit in round 1, fixed in round 2: a value a user's command re-added under an id
// deleted before is not a copy of the earlier value (no `redone` links them), so round 1's walk
// along copies did not see that Bob's concurrent add lost to it. Offline, Ada adds v4, deletes
// it and adds it again under the same id while Bob adds v4 and attaches a segment. The causal
// test sees Bob's write outside the re-add's past: undoing the re-add keeps v4 (the value that
// won, or Bob's) and removes only Ada's segment; Bob's segment keeps its vertex throughout.
describe.each(ORDERS)('undo of a re-add raced by the same add ($name)', (order) => {
  it('keeps v4 when undoing the re-add of an id another client added at the same time', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    addMember(ada);
    ada.transact(ADA, (transaction) => {
      transaction.deleteSegment(PATH_ID, 's3');
      transaction.deleteVertex(PATH_ID, 'v4');
    });
    addMember(ada);
    bobWritesVertex(bob, 500);
    link.reconnect();
    const merged = order.adaClientId > order.bobClientId ? ADDED_VERTEX.x : 500;
    expect(vertexX(ada)).toBe(merged);
    expect(history.undo()).toBe(true);
    link.deliver();
    expectVertexKept(ada, bob, merged);
  });
});
