// Acceptance sync tests, written from the ticket before the code (Red lane), Done means 4:
// a restore with an edit concurrent with it. Ada's and Bob's clients each hold a store, linked
// as the relay links them; Ada restores while Bob, not yet having her restore, edits. Every
// client converges, the board stays readable, and Bob's concurrent edit is not lost.
//
// This file imports `./restore-board.js`, which does not exist before the implementation, so the
// whole file fails to load on main (a typed dynamic import, below); it tests only that new module.
//
// CONTRACT: `restoreBoardCommand`, input `{ state: Uint8Array }` (restore-board.acceptance.test.ts).
//
// Asserted beyond convergence, from the ticket's "later objects deleted, changed ones restored,
// deleted ones re-created": the restore writes only objects that differ from the chosen state,
// so a concurrent edit of an object it does not touch, or a concurrent creation it cannot know
// of, survives. Not asserted: which write wins when both change the same field (only that both
// clients agree).
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { BoardObject } from '@canvas/schema';

import { Link } from '../history/__fixtures__/history-fixtures.js';
import {
  ADA,
  BOB,
  createSyncedPair,
  fixtureObject,
  id,
  unreadableEntries,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { NOW, testEnvironment } from './__fixtures__/command-fixtures.js';
import type { Command } from './command.js';
import { runCommand } from './run-command.js';

/**
 * The command as these tests use it. It is loaded with a typed dynamic import because
 * `restore-board.ts` does not exist before the implementation; the cast keeps lint clean.
 */
type RestoreBoardCommand = Command<
  z.ZodType<{ state: Uint8Array }, { state: Uint8Array }>,
  unknown,
  unknown
>;

const { restoreBoardCommand } = (await import('./restore-board.js')) as {
  readonly restoreBoardCommand: RestoreBoardCommand;
};

const VIDEO = fixtureObject('video-demo', 'video');
const PATH = fixtureObject('path-squiggle', 'path');

/**
 * Checks both peers hold the same, readable board.
 *
 * @param first - One store.
 * @param second - The other.
 */
function expectConverged(first: DocumentStore, second: DocumentStore): void {
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
  expect(unreadableEntries(first)).toEqual([]);
  expect(unreadableEntries(second)).toEqual([]);
}

/**
 * Two linked clients; the chosen state is the fixture board; then Ada moves the video and
 * deletes the divider, delivered to Bob.
 *
 * @returns The stores, the link and the chosen state.
 */
function clientsAfterChanges(): {
  ada: DocumentStore;
  bob: DocumentStore;
  link: Link;
  chosen: Uint8Array;
} {
  const [ada, bob] = createSyncedPair();
  const link = new Link(ada, bob);
  const chosen = ada.encodeState();
  ada.transact(ADA, (transaction) => {
    transaction.setObject({ ...VIDEO, x: 500, updatedAt: NOW + 1 });
    transaction.deleteObject(id('line-divider'));
  });
  link.deliver();
  return { ada, bob, link, chosen };
}

/**
 * Restores a state as Ada.
 *
 * @param store - Ada's store.
 * @param state - The chosen state.
 */
function restore(store: DocumentStore, state: Uint8Array): void {
  const outcome = runCommand(store, ADA, restoreBoardCommand, { state }, testEnvironment());
  expect(outcome.status).toBe('applied');
}

describe('restoreBoard across peers', () => {
  it("converges with Bob's concurrent edit and creation, keeping both", () => {
    const { ada, bob, link, chosen } = clientsAfterChanges();
    link.disconnect();
    restore(ada, chosen);
    const bobSticky: BoardObject = {
      ...fixtureObject('sticky-idea', 'sticky'),
      id: id('sticky-bob'),
      parentId: null,
      z: 'a9',
    };
    bob.transact(BOB, (transaction) => {
      transaction.setObject({ ...PATH, x: PATH.x + 50, updatedAt: NOW + 2 });
      transaction.setObject(bobSticky);
    });
    link.reconnect();
    expectConverged(ada, bob);
    for (const store of [ada, bob]) {
      // The restore: the video back, the divider re-created.
      expect(store.get(id('video-demo'))).toMatchObject({ x: VIDEO.x });
      expect(store.get(id('line-divider'))).toBeDefined();
      // Bob's concurrent work: neither lost.
      expect(store.get(id('path-squiggle'))).toMatchObject({ x: PATH.x + 50 });
      expect(store.get(bobSticky.id)).toBeDefined();
    }
  });

  it('converges when Bob concurrently edits an object the restore changes back', () => {
    const { ada, bob, link, chosen } = clientsAfterChanges();
    link.disconnect();
    restore(ada, chosen);
    bob.transact(BOB, (transaction) => {
      transaction.setObject({ ...VIDEO, x: 900, updatedAt: NOW + 3 });
    });
    link.reconnect();
    expectConverged(ada, bob);
    expect([VIDEO.x, 900]).toContain(ada.get(id('video-demo'))?.x);
  });

  it('converges when Bob concurrently deletes an object the restore re-creates', () => {
    const [ada, bob] = createSyncedPair();
    const link = new Link(ada, bob);
    const chosen = ada.encodeState();
    ada.transact(ADA, (transaction) => {
      transaction.setObject({ ...VIDEO, x: 500, updatedAt: NOW + 1 });
    });
    link.deliver();
    link.disconnect();
    restore(ada, chosen);
    bob.transact(BOB, (transaction) => {
      transaction.deleteObject(id('video-demo'));
    });
    link.reconnect();
    expectConverged(ada, bob);
  });
});
