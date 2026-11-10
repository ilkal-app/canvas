import { describe, expect, it } from 'vitest';

import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import {
  addMember,
  deleteEnd,
  expectValidBoard,
  membersOf,
  moveVertex,
  PATH_ID,
} from './__fixtures__/network-member-fixtures.js';
import { createHistory } from './undo-manager.js';

// Undo, redo and undo again of a vector network member's addition, deletion and
// overwrite, with a collaborator writing in between. An edit of a different member must not
// change what Ada's history does; a later edit of the same member by Bob is his, and stays.

/**
 * Two linked clients holding the fixture board, with Ada's history.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The stores, the link and Ada's history.
 */
function linked(adaClientId: number, bobClientId: number) {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  const link = new Link(ada, bob);
  return { ada, bob, link, history: createHistory(ada, ADA_ID) };
}

/**
 * Bob deletes the member s3 and v4 that {@link addMember} adds.
 *
 * @param store - Bob's store.
 */
function deleteAddedAsBob(store: DocumentStore): void {
  store.transact(BOB, (transaction) => {
    transaction.deleteSegment(PATH_ID, 's3');
    transaction.deleteVertex(PATH_ID, 'v4');
  });
}

/**
 * Checks both clients hold the same valid board.
 *
 * @param ada - Ada's store.
 * @param bob - Bob's store.
 */
function expectConverged(ada: DocumentStore, bob: DocumentStore): void {
  expectValidBoard(ada);
  expectValidBoard(bob);
  expect(new Map(ada.read().objects)).toEqual(new Map(bob.read().objects));
}

/**
 * Replaces one member line (`v1@0,0`) of a network listing.
 *
 * @param members - The listing.
 * @param from - The line to replace.
 * @param to - Its replacement.
 * @returns A new, sorted listing.
 */
function replaced(members: readonly string[], from: string, to: string): string[] {
  return members.map((member) => (member === from ? to : member)).sort();
}

describe.each(ORDERS)('undo and redo of network members ($name)', (order) => {
  describe('with a collaborator editing a different member', () => {
    it('undoes, redoes and undoes an addition as alone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      const before = membersOf(ada);
      addMember(ada);
      link.deliver();
      const added = membersOf(ada);
      expect(history.undo()).toBe(true);
      link.deliver();
      moveVertex(bob, 'v1', 55, BOB);
      link.deliver();
      expect(history.redo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toEqual(replaced(added, 'v1@0,0', 'v1@55,0'));
      expect(history.undo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toEqual(replaced(before, 'v1@0,0', 'v1@55,0'));
      expectConverged(ada, bob);
    });

    it('undoes, redoes and undoes a deletion as alone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      const before = membersOf(ada);
      deleteEnd(ada);
      link.deliver();
      const deleted = membersOf(ada);
      expect(history.undo()).toBe(true);
      link.deliver();
      moveVertex(bob, 'v1', 55, BOB);
      link.deliver();
      expect(history.redo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toEqual(replaced(deleted, 'v1@0,0', 'v1@55,0'));
      expect(history.undo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toEqual(replaced(before, 'v1@0,0', 'v1@55,0'));
      expectConverged(ada, bob);
    });

    it('undoes, redoes and undoes an overwrite as alone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      const before = membersOf(ada);
      moveVertex(ada, 'v3', 333);
      link.deliver();
      expect(history.undo()).toBe(true);
      link.deliver();
      moveVertex(bob, 'v1', 55, BOB);
      link.deliver();
      expect(history.redo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toContain('v3@333,50');
      expect(history.undo()).toBe(true);
      link.deliver();
      expect(membersOf(bob)).toEqual(replaced(before, 'v1@0,0', 'v1@55,0'));
      expectConverged(ada, bob);
    });
  });

  describe('with a collaborator overwriting the same member', () => {
    it('keeps his value of a member whose redone addition is undone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      const before = membersOf(ada);
      addMember(ada);
      history.undo();
      history.redo();
      link.deliver();
      moveVertex(bob, 'v4', 444, BOB);
      link.deliver();
      // The segment Ada added goes; the vertex is Bob's now, and stays.
      expect(history.undo()).toBe(true);
      link.deliver();
      expect(membersOf(ada)).toEqual([...before, 'v4@444,0'].sort());
      expectConverged(ada, bob);
    });

    it('keeps his value of a member whose undone deletion is redone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      deleteEnd(ada);
      history.undo();
      link.deliver();
      moveVertex(bob, 'v3', 333, BOB);
      link.deliver();
      expect(history.redo()).toBe(true);
      link.deliver();
      expect(membersOf(ada)).toEqual(['s1:v1-v2', 'v1@0,0', 'v2@100,0', 'v3@333,50']);
      expectConverged(ada, bob);
    });

    it('keeps his value of a member whose redone overwrite is undone', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      moveVertex(ada, 'v3', 333);
      history.undo();
      history.redo();
      link.deliver();
      moveVertex(bob, 'v3', 444, BOB);
      link.deliver();
      history.undo();
      link.deliver();
      expect(membersOf(ada)).toContain('v3@444,50');
      expectConverged(ada, bob);
    });

    // Bob moves v3 while Ada, offline, deletes it and undoes the delete. The merge keeps one
    // of the two concurrent values; when it keeps Ada's re-created one, that value won Bob's
    // write, so redoing the delete keeps it (field-guard case 1) rather than leave the key
    // without the value both clients now agree on.
    it("keeps whichever value won when his move raced Ada's undone deletion", () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      link.disconnect();
      deleteEnd(ada);
      history.undo();
      moveVertex(bob, 'v3', 444, BOB);
      link.reconnect();
      const merged = membersOf(ada);
      const isAdaWinning = order.adaClientId > order.bobClientId;
      expect(merged).toContain(isAdaWinning ? 'v3@200,50' : 'v3@444,50');
      expect(history.redo()).toBe(true);
      link.deliver();
      expect(membersOf(ada)).toEqual(merged.filter((member) => !member.startsWith('s2:')));
      expectConverged(ada, bob);
    });
  });

  describe('with a collaborator deleting the same member', () => {
    it('changes nothing when undoing a redone addition he removed', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      const before = membersOf(ada);
      addMember(ada);
      history.undo();
      history.redo();
      link.deliver();
      deleteAddedAsBob(bob);
      link.deliver();
      expect(history.undo()).toBe(false);
      link.deliver();
      expect(membersOf(ada)).toEqual(before);
      expectConverged(ada, bob);
    });

    it('changes nothing when redoing a deletion he made again', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      deleteEnd(ada);
      const deleted = membersOf(ada);
      history.undo();
      link.deliver();
      deleteEnd(bob, BOB);
      link.deliver();
      expect(history.redo()).toBe(false);
      link.deliver();
      expect(membersOf(ada)).toEqual(deleted);
      expectConverged(ada, bob);
    });

    // Yjs restores the value a step overwrote even when someone has since deleted the key: the
    // deleted value is the step's own, which it may replace. The vertex comes back alone.
    it('restores the first value when undoing a redone overwrite of a member he deleted', () => {
      const { ada, bob, link, history } = linked(order.adaClientId, order.bobClientId);
      moveVertex(ada, 'v3', 333);
      history.undo();
      history.redo();
      link.deliver();
      deleteEnd(bob, BOB);
      link.deliver();
      expect(history.undo()).toBe(true);
      link.deliver();
      expect(membersOf(ada)).toEqual(['s1:v1-v2', 'v1@0,0', 'v2@100,0', 'v3@200,50']);
      expectConverged(ada, bob);
    });
  });
});
