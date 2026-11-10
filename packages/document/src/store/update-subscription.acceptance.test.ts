import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { ADA, fixtureObject, id, RELAY } from './__fixtures__/store-fixtures.js';
import type { DocumentUpdate } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

describe('Yjs update subscriptions', () => {
  it('attaches the Yjs update handler only while at least one update listener exists', () => {
    const on = vi.spyOn(Y.Doc.prototype, 'on');
    const off = vi.spyOn(Y.Doc.prototype, 'off');
    try {
      const store = new YjsDocumentStore({ clientId: 1 });
      const updateCalls = () => on.mock.calls.filter(([event]) => event === 'update').length;
      const removalCalls = () => off.mock.calls.filter(([event]) => event === 'update').length;

      expect(updateCalls()).toBe(0);
      const first = store.subscribeUpdates(() => undefined);
      expect(updateCalls()).toBe(1);
      const second = store.subscribeUpdates(() => undefined);
      expect(updateCalls()).toBe(1);
      first();
      expect(removalCalls()).toBe(0);
      second();
      expect(removalCalls()).toBe(1);
      const third = store.subscribeUpdates(() => undefined);
      expect(updateCalls()).toBe(2);
      third();
      expect(removalCalls()).toBe(2);
      store.destroy();
    } finally {
      on.mockRestore();
      off.mockRestore();
    }
  });

  it('delivers local and applied updates to existing and later listeners with their origins', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const peer = new YjsDocumentStore({ clientId: 2 });
    const first: DocumentUpdate[] = [];
    const second: DocumentUpdate[] = [];
    const stopFirst = store.subscribeUpdates((update) => first.push(update));

    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), id: id('local') });
    });
    const localCount = first.length;
    const stopSecond = store.subscribeUpdates((update) => second.push(update));
    peer.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), id: id('remote') });
    });
    store.applyUpdate(peer.encodeState(), RELAY);

    expect(localCount).toBeGreaterThan(0);
    expect(first).toHaveLength(localCount + second.length);
    expect(second).toEqual(first.slice(localCount));
    expect(first[0]).toMatchObject({ origin: ADA, isLocal: true });
    expect(second).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin: RELAY, isLocal: false })]),
    );
    expect(first.every(({ update }) => update.byteLength > 0)).toBe(true);
    stopFirst();
    stopSecond();
    store.destroy();
    peer.destroy();
  });
});
