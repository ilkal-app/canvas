// Acceptance tests, written from the ticket before the code (Red lane), Done means 4-6:
// the restore command. One new update under the person's own origin makes the board equal to
// the chosen state (later objects deleted, changed ones restored, deleted ones re-created); one
// undo returns the board to before the restore; a large restore goes in parts, still
// one undo step; a state in a layout this build does not read is refused.
//
// This file imports `./restore-board.js`, which does not exist before the implementation, so the
// whole file fails to load on main (a typed dynamic import, below); it tests only that new module.
//
// CONTRACT (names chosen here; agree a rename with the test author rather than drifting):
// - `restoreBoardCommand` in `packages/document/src/commands/restore-board.ts` (exported from
//   `@canvas/document` too), a `Command` run by `runCommand`, named `restoreBoard`.
// - Its input is `{ state: Uint8Array }`: the chosen board as one Yjs update (v1), as the relay's
//   history routes serve it (`GET /boards/:id/history/state`, `.../versions/:id/state`).
//
// Deliberately not asserted: the command's result value, `updatedAt` of the objects it writes
// (`runCommand` stamps the command's time on every object a command writes, by design), how the
// restore is marked for the timeline, the refusal's error codes.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { z } from 'zod';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA_ID, BOB_ID, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import {
  DOCUMENT_META_KEY,
  META_MAP_NAME,
  READABLE_LAYOUT_VERSIONS,
} from '../meta/document-meta.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  fixtureObject,
  id,
  unreadableEntries,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore, DocumentUpdate } from '../store/document-store.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { expectRejected, NOW, testEnvironment } from './__fixtures__/command-fixtures.js';
import type { Command } from './command.js';
import { MAX_OBJECTS_PER_TRANSACTION } from './create-objects-parts.js';
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

/** A sticky created after the chosen state, by Bob. */
const LATER_STICKY: BoardObject = {
  ...fixtureObject('sticky-idea', 'sticky'),
  id: id('sticky-later'),
  parentId: null,
  z: 'a9',
  createdBy: BOB_ID,
};

/**
 * An object without `updatedAt`.
 *
 * @param object - The object.
 * @returns Its other fields.
 */
function withoutUpdatedAt(object: BoardObject): Omit<BoardObject, 'updatedAt'> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt')) as Omit<
    BoardObject,
    'updatedAt'
  >;
}

/**
 * A board's objects without `updatedAt`, which a command stamps with its own time.
 *
 * @param store - The store.
 * @returns The objects by id.
 */
function objectsOf(store: DocumentStore): Map<ObjectId, Omit<BoardObject, 'updatedAt'>> {
  return new Map(
    [...store.read().objects].map(([objectId, object]) => {
      return [objectId, withoutUpdatedAt(object)];
    }),
  );
}

/**
 * Bob's edits after the chosen state: a new sticky, the video moved, the divider deleted.
 *
 * @param store - Bob's store.
 */
function editAfterwards(store: DocumentStore): void {
  store.transact(BOB, (transaction) => {
    transaction.setObject(LATER_STICKY);
  });
  store.transact(BOB, (transaction) => {
    transaction.setObject({ ...fixtureObject('video-demo', 'video'), x: 999, updatedAt: NOW + 1 });
  });
  store.transact(BOB, (transaction) => {
    transaction.deleteObject(id('line-divider'));
  });
}

/**
 * Restores a state as Ada and checks the command applied.
 *
 * @param store - The store.
 * @param state - The chosen state.
 */
function restore(store: DocumentStore, state: Uint8Array): void {
  const outcome = runCommand(store, ADA, restoreBoardCommand, { state }, testEnvironment());
  expect(outcome.status).toBe('applied');
}

/**
 * The state with its metadata stamp replaced by one naming a layout this build does not read.
 *
 * @param state - A board state.
 * @returns The restamped state.
 */
function withUnreadableLayout(state: Uint8Array): Uint8Array {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  const meta = document.getMap(META_MAP_NAME);
  meta.set(DOCUMENT_META_KEY, {
    ...(meta.get(DOCUMENT_META_KEY) as object),
    layoutVersion: Math.max(...READABLE_LAYOUT_VERSIONS) + 1,
  });
  const restamped = Y.encodeStateAsUpdate(document);
  document.destroy();
  return restamped;
}

describe('restoreBoard', () => {
  it('makes the board equal to the chosen state: later objects deleted, changed ones restored, deleted ones re-created', () => {
    const store = createFixtureStore();
    const chosen = store.encodeState();
    const expected = objectsOf(store);
    editAfterwards(store);
    expect(store.get(LATER_STICKY.id)).toBeDefined();
    restore(store, chosen);
    expect(objectsOf(store)).toEqual(expected);
    expect(store.get(LATER_STICKY.id)).toBeUndefined();
    expect(store.get(id('video-demo'))).toMatchObject({
      x: fixtureObject('video-demo', 'video').x,
    });
    expect(store.get(id('line-divider'))).toMatchObject(
      withoutUpdatedAt(fixtureObject('line-divider', 'line')),
    );
    expect(unreadableEntries(store)).toEqual([]);
  });

  it("writes one new update under the person's own origin", () => {
    const store = createFixtureStore();
    const chosen = store.encodeState();
    editAfterwards(store);
    const updates: DocumentUpdate[] = [];
    const origins: unknown[] = [];
    const stopUpdates = store.subscribeUpdates((update) => updates.push(update));
    const stopChanges = store.subscribe((changes) => origins.push(changes.origin));
    restore(store, chosen);
    stopUpdates();
    stopChanges();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ origin: ADA, isLocal: true });
    expect(origins).toEqual([ADA]);
  });

  it('leaves untouched the objects that have not changed since the chosen state', () => {
    const store = createFixtureStore();
    const chosen = store.encodeState();
    editAfterwards(store);
    const changed: ObjectId[] = [];
    store.subscribe((changes) => {
      changed.push(...changes.created, ...changes.updated, ...changes.deleted);
    });
    restore(store, chosen);
    expect([...new Set(changed)].sort()).toEqual(
      [LATER_STICKY.id, id('line-divider'), id('video-demo')].sort(),
    );
  });

  it('is undone in one step, returning the board to before the restore', () => {
    const store = createFixtureStore();
    const chosen = store.encodeState();
    editAfterwards(store);
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA_ID);
    restore(store, chosen);
    expect(history.undo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(unreadableEntries(store)).toEqual([]);
  });

  it('is undone without deleting what others wrote since', () => {
    const [ada, bob] = createSyncedPair();
    const link = new Link(ada, bob);
    const chosen = ada.encodeState();
    editAfterwards(bob);
    link.deliver();
    const adaHistory = createHistory(ada, ADA_ID);
    restore(ada, chosen);
    link.deliver();
    expect(bob.get(id('line-divider'))).toBeDefined();
    // Since the restore Bob writes to the divider it re-created and adds a sticky of his own.
    const bobSticky: BoardObject = { ...LATER_STICKY, id: id('sticky-bob'), z: 'a8' };
    bob.transact(BOB, (transaction) => {
      transaction.setObject({
        ...fixtureObject('line-divider', 'line'),
        y: 777,
        updatedAt: NOW + 2,
      });
      transaction.setObject(bobSticky);
    });
    link.deliver();
    expect(adaHistory.undo()).toBe(true);
    link.deliver();
    for (const store of [ada, bob]) {
      // The restore's other changes are undone: Bob's later sticky is back, the video moved again.
      expect(store.get(LATER_STICKY.id)).toBeDefined();
      expect(store.get(id('video-demo'))).toMatchObject({ x: 999 });
      // What Bob wrote after the restore stays: his sticky, and the divider he edited.
      expect(store.get(bobSticky.id)).toBeDefined();
      expect(store.get(id('line-divider'))).toMatchObject({ y: 777 });
      expect(unreadableEntries(store)).toEqual([]);
    }
    expect(new Map(ada.read().objects)).toEqual(new Map(bob.read().objects));
  });

  it('restores a large board in parts of at most MAX_OBJECTS_PER_TRANSACTION objects, one undo step', () => {
    const store: YjsDocumentStore = createFixtureStore();
    const chosen = store.encodeState();
    const expected = objectsOf(store);
    const count = 2 * MAX_OBJECTS_PER_TRANSACTION + 500;
    for (let start = 0; start < count; start += 500) {
      store.transact(BOB, (transaction) => {
        for (let index = start; index < start + 500; index += 1) {
          transaction.setObject({
            ...LATER_STICKY,
            id: id(`later-${String(index).padStart(5, '0')}`),
          });
        }
      });
    }
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA_ID);
    const parts: number[] = [];
    const stop = store.subscribe((changes) => {
      parts.push(changes.created.length + changes.updated.length + changes.deleted.length);
    });
    restore(store, chosen);
    stop();
    expect(objectsOf(store)).toEqual(expected);
    expect(parts.length).toBeGreaterThan(1);
    for (const size of parts) expect(size).toBeLessThanOrEqual(MAX_OBJECTS_PER_TRANSACTION);
    expect(history.undo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(before);
    expect(history.canUndo()).toBe(false);
  });

  it('refuses a state in a stored layout this build does not read, and writes nothing', () => {
    const store = createFixtureStore();
    const chosen = withUnreadableLayout(store.encodeState());
    editAfterwards(store);
    expect(expectRejected(store, restoreBoardCommand, { state: chosen }).length).toBeGreaterThan(0);
  });

  it('refuses bytes that are not a board state, and writes nothing', () => {
    const store = createFixtureStore();
    expect(
      expectRejected(store, restoreBoardCommand, { state: Uint8Array.of(1, 2, 3) }).length,
    ).toBeGreaterThan(0);
  });
});
