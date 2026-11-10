import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';

import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  fixtureObject,
  id,
  RELAY,
} from './__fixtures__/store-fixtures.js';
import type { DocumentUpdate } from './document-store.js';
import { internalsOf } from './internal.js';
import { YjsDocumentStore } from './yjs-document-store.js';

// A silent `applyUpdate` leaves update listeners out of the applied update itself, so
// Yjs encodes nothing for it, but every local transaction it causes still reaches them, and the
// store's listening follows its listeners even when they change during the apply.

/**
 * Whether a store's Y.Doc has an `update` handler, so Yjs encodes each transaction's update.
 *
 * @param store - The store.
 * @returns True while one is attached.
 */
function isListening(store: YjsDocumentStore): boolean {
  return internalsOf(store).doc._observers.has('update');
}

describe('silent applyUpdate', () => {
  it('still delivers the local formatting cleanup a silent remote update causes', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { weight: 700 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { weight: 700 });
    });
    const updates: DocumentUpdate[] = [];
    bob.subscribeUpdates((update) => updates.push(update));
    bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY, { isSilent: true });
    // The remote update is not handed over; the cleanup Yjs made locally is.
    expect(updates.map(({ origin, isLocal }) => [origin, isLocal])).toEqual([
      [SYSTEM_ORIGIN, true],
    ]);
    // And it is what a peer needs: applying it leaves the two stores equal.
    const peer = new YjsDocumentStore();
    peer.applyUpdate(bob.encodeState(), RELAY);
    expect(peer.read().objects).toEqual(bob.read().objects);
  });

  it('starts listening after the apply for a listener subscribed during it', () => {
    const source = createFixtureStore();
    const store = new YjsDocumentStore();
    const updates: DocumentUpdate[] = [];
    let isSubscribed = false;
    store.subscribe(() => {
      if (isSubscribed) return;
      isSubscribed = true;
      store.subscribeUpdates((update) => updates.push(update));
    });
    store.applyUpdate(source.encodeState(), RELAY, { isSilent: true });
    expect(isSubscribed).toBe(true);
    expect(updates).toEqual([]);
    expect(isListening(store)).toBe(true);
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), id: id('later') });
    });
    expect(updates.map(({ origin, isLocal }) => [origin, isLocal])).toEqual([[ADA, true]]);
  });

  it('stops listening after the apply when the last listener left during it', () => {
    const source = createFixtureStore();
    const store = new YjsDocumentStore();
    const stop = store.subscribeUpdates(() => undefined);
    store.subscribe(() => {
      stop();
    });
    store.applyUpdate(source.encodeState(), RELAY, { isSilent: true });
    expect(isListening(store)).toBe(false);
  });

  it('reports no held deletion to update listeners for a silent update', () => {
    /**
     * The updates of a sticky made, written twice and then deleted, from one writer.
     *
     * @returns The creation, the two edits and the deletion.
     */
    const deliveries = (): Uint8Array[] => {
      const source = new YjsDocumentStore({ clientId: 10 });
      const sent: Uint8Array[] = [];
      source.subscribeUpdates(({ update }) => sent.push(update));
      source.transact(ADA, (transaction) => {
        transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), parentId: null });
      });
      source.transact(ADA, (transaction) => {
        transaction.insertText(id('sticky-idea'), 0, 'A', BODY);
      });
      source.transact(ADA, (transaction) => {
        transaction.insertText(id('sticky-idea'), 0, 'B', BODY);
      });
      source.transact(ADA, (transaction) => transaction.deleteObject(id('sticky-idea')));
      source.destroy();
      return sent;
    };
    /**
     * What update listeners hear when, after the creation, the second edit arrives without the
     * first (Yjs holds it, missing its dependency) and then the sticky's deletion, which the store
     * holds behind it (`HeldDeletes`).
     *
     * @param isSilent - Whether the deletion is applied silently.
     * @returns The updates heard while applying the deletion.
     * @throws {Error} When the fixture lacks an update.
     */
    const heardOnDeletion = (isSilent: boolean): DocumentUpdate[] => {
      const [creation, , secondEdit, deletion] = deliveries();
      if (!creation || !secondEdit || !deletion) throw new Error('missing fixture update');
      const target = new YjsDocumentStore({ clientId: 20 });
      target.applyUpdate(creation, RELAY);
      target.applyUpdate(secondEdit, RELAY);
      expect(internalsOf(target).doc.store.pendingStructs).not.toBeNull();
      const heard: DocumentUpdate[] = [];
      target.subscribeUpdates((update) => heard.push(update));
      target.applyUpdate(deletion, RELAY, { isSilent });
      target.destroy();
      return heard;
    };
    // The control: an ordinary apply reports the held deletion's bytes to update listeners.
    expect(heardOnDeletion(false).length).toBeGreaterThan(0);
    expect(heardOnDeletion(true)).toEqual([]);
  });
});
