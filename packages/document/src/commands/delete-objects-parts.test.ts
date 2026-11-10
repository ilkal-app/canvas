// Fix round 2: a delete of more than MAX_OBJECTS_PER_TRANSACTION objects runs as
// transactions of at most that many, referrers first, one undo step; its undo re-creates one
// part per transaction, referents first. A peer applying each transaction alone never sees a
// dangling reference and never repairs; the grouped steps keep's guards.
import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { ADA, BOB } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand } from './create-objects.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import type { NewObject } from './new-object-schema.js';

/** The fields `createObjects` generates, which a listed object leaves out. */
const GENERATED = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

/**
 * How many references among a board's objects point at an object not on it.
 *
 * @param objects - The board's objects.
 * @returns The count.
 */
function danglingCount(objects: ReadonlyMap<ObjectId, BoardObject>): number {
  let dangling = 0;
  for (const object of objects.values()) {
    const targets = [object.parentId];
    if (object.type === 'connector') {
      for (const end of [object.from, object.to]) {
        if (end.kind === 'object') targets.push(end.objectId);
      }
    }
    if (object.type === 'comment' && object.anchor.kind === 'object') {
      targets.push(object.anchor.objectId);
    }
    dangling += targets.filter((target) => target !== null && !objects.has(target)).length;
  }
  return dangling;
}

/**
 * A store and an editor peer fed each of its updates on its own, counting what the peer saw.
 *
 * @returns The store, the peer, and the peer's dangling references and repair writes so far.
 */
function storeWithPeer() {
  const store = new YjsDocumentStore({ clientId: 2_001 });
  const peer = new YjsDocumentStore({ clientId: 2_002 });
  const seen = { transactions: 0, dangling: 0, repairs: 0 };
  peer.subscribeUpdates(({ isLocal }) => {
    if (isLocal) seen.repairs += 1;
  });
  store.subscribeUpdates(({ update }) => {
    seen.transactions += 1;
    peer.applyUpdate(update, SYSTEM_ORIGIN);
    seen.dangling += danglingCount(peer.read().objects);
  });
  return { store, peer, seen };
}

it(
  'deletes 2,500 objects in three transactions and undoes and redoes them as one step',
  { timeout: 30_000 },
  () => {
    const { store, peer, seen } = storeWithPeer();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of createLargeBoardObjects(2_500, 71)) transaction.setObject(object);
    });
    const history = createHistory(store, ADA_ID);
    const frames = [...store.read().objects.values()].filter((object) => object.type === 'frame');
    seen.transactions = 0;
    const { result } = applyCommand(store, deleteObjectsCommand, {
      ids: frames.map(({ id }) => id),
    });
    expect(result.deletedIds).toHaveLength(2_500);
    expect(seen.transactions).toBe(3);
    expect(store.read().objects.size).toBe(0);
    seen.transactions = 0;
    expect(history.undo()).toBe(true);
    expect(seen.transactions).toBeGreaterThanOrEqual(3);
    expect(store.read().objects.size).toBe(2_500);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(store.read().objects.size).toBe(0);
    expect(history.canRedo()).toBe(false);
    expect(seen).toMatchObject({ dangling: 0, repairs: 0 });
    expect(peer.encodeStateVector()).toEqual(store.encodeStateVector());
  },
);

it(
  'keeps an object of a grouped paste another person wrote to, when the paste is undone',
  { timeout: 30_000 },
  () => {
    const store = new YjsDocumentStore({ clientId: 2_003 });
    const history = createHistory(store, ADA_ID);
    const objects = createLargeBoardObjects(2_500, 72).map(
      (object) =>
        Object.fromEntries(
          Object.entries(object).filter(([key]) => !GENERATED.has(key)),
        ) as unknown as NewObject,
    );
    const { result } = applyCommand(
      store,
      createObjectsCommand,
      { objects },
      ADA,
      testEnvironment(3),
    );
    // A peer edits an object the second of the paste's three transactions wrote.
    const touched = result.ids[1_500] ?? ('' as ObjectId);
    const peer = new YjsDocumentStore({ clientId: 2_004 });
    peer.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
    const before = peer.encodeStateVector();
    applyCommand(peer, moveObjectsCommand, { moves: [{ id: touched, by: { x: 10, y: 0 } }] }, BOB);
    store.applyUpdate(peer.encodeSyncState(before), SYSTEM_ORIGIN);
    expect(history.undo()).toBe(true);
    expect(store.get(touched)).toBeDefined();
    expect(store.read().objects.size).toBeLessThan(2_500);
  },
);
