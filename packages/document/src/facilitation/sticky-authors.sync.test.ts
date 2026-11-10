import { describe, expect, it } from 'vitest';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import {
  ADA,
  BOB,
  RELAY,
  createSyncedPair,
  exchange,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { setStickyAuthorsCommand } from './facilitation-api.js';

/**
 * Runs the public command on one peer.
 *
 * @param store - The peer.
 * @param isShown - Whether authors are shown.
 */
function setShown(store: YjsDocumentStore, isShown: boolean): void {
  applyCommand(store, setStickyAuthorsCommand, { isShown });
}

describe('sticky author setting sync', () => {
  it.each([
    ['first then second', [0, 1]],
    ['second then first', [1, 0]],
  ] as const)('converges after two writes delivered %s', (name, order) => {
    expect(name.length).toBeGreaterThan(0);
    const [ada, bob] = createSyncedPair();
    const base = ada.encodeState();
    const updates: Uint8Array[] = [];
    for (const [index, store] of [ada, bob].entries()) {
      const before = store.encodeStateVector();
      store.transact(index === 0 ? ADA : BOB, (transaction) => {
        transaction.setStickyAuthors(index === 0);
      });
      updates.push(store.encodeState(before));
    }
    const replay = new YjsDocumentStore();
    replay.applyUpdate(base, RELAY);
    for (const index of order) replay.applyUpdate(updates[index] ?? new Uint8Array(), RELAY);
    exchange(ada, bob);
    expect(ada.stickyAuthors.current).toBe(bob.stickyAuthors.current);
    expect(replay.stickyAuthors.current).toBe(ada.stickyAuthors.current);
  });

  it('shows a late joiner the shared setting', () => {
    const [ada] = createSyncedPair();
    setShown(ada, true);
    const late = new YjsDocumentStore();
    late.applyUpdate(ada.encodeState(), RELAY);
    expect(late.stickyAuthors.current).toBe(true);
  });

  it('converges concurrent different writes to one boolean on both peers and both replay orders', () => {
    const [ada, bob] = createSyncedPair();
    setShown(ada, true);
    exchange(ada, bob);
    const base = ada.encodeState();
    const adaBefore = ada.encodeStateVector();
    const bobBefore = bob.encodeStateVector();
    ada.transact(ADA, (transaction) => {
      transaction.setStickyAuthors(false);
    });
    bob.transact(BOB, (transaction) => {
      transaction.setStickyAuthors(false);
    });
    bob.transact(BOB, (transaction) => {
      transaction.setStickyAuthors(true);
    });
    const fromAda = ada.encodeState(adaBefore);
    const fromBob = bob.encodeState(bobBefore);
    const replays = [
      [fromAda, fromBob],
      [fromBob, fromAda],
    ].map((updates) => {
      const copy = new YjsDocumentStore();
      copy.applyUpdate(base, RELAY);
      for (const update of updates) copy.applyUpdate(update, RELAY);
      return copy;
    });
    exchange(ada, bob);
    const values = [ada, bob, ...replays].map((store) => store.stickyAuthors.current);
    expect(values.every((isShown) => isShown === values[0])).toBe(true);
    expect(typeof values[0]).toBe('boolean');
  });
});
