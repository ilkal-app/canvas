import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { readUpdateShape } from '../assets/update-scan.js';

import { pendingSeed2354 } from './__fixtures__/pending-seed-2354.js';
import { ADA, BODY, fixtureObject, id, RELAY } from './__fixtures__/store-fixtures.js';
import { HeldDeletes } from './held-deletes.js';
import { internalsOf } from './internal.js';
import { applyRemoteUpdate, finishRemoteUpdate } from './remote-update.js';
import { YjsDocumentStore } from './yjs-document-store.js';

describe('merged deliveries with pending dependencies', () => {
  it('integrates every delivered struct in seed 2354', () => {
    const store = new YjsDocumentStore({ clientId: 2000 });
    for (const update of pendingSeed2354()) store.applyUpdate(update, RELAY);
    const { doc } = internalsOf(store);
    expect(doc.store.pendingStructs === null).toBe(true);
    expect(doc.store.pendingDs).toBeNull();
    const cold = new Y.Doc();
    Y.applyUpdate(cold, store.encodeState());
    expect(Y.decodeStateVector(store.encodeStateVector())).toEqual(
      Y.decodeStateVector(Y.encodeStateVector(cold)),
    );
    store.destroy();
    cold.destroy();
  });

  it('retries already held bytes in one attributed remote transaction', () => {
    const doc = new Y.Doc();
    const updates = pendingSeed2354();
    const last = updates.pop();
    if (!last) throw new Error('missing final fixture delivery');
    for (const update of updates) Y.applyUpdate(doc, update);
    const origins: unknown[] = [];
    doc.on('update', (update, origin, changedDoc, transaction: Y.Transaction) => {
      if (!transaction.local) origins.push(origin);
    });
    applyRemoteUpdate(doc, last, readUpdateShape(last), new HeldDeletes(), RELAY, {});
    expect(doc.store.pendingStructs === null).toBe(true);
    expect(doc.store.pendingDs).toBeNull();
    expect(origins).toEqual([RELAY]);
    doc.destroy();
  });

  it('keeps genuinely missing structs until their exact dependency arrives', () => {
    const source = new YjsDocumentStore({ clientId: 10 });
    const target = new YjsDocumentStore({ clientId: 20 });
    const updates: Uint8Array[] = [];
    source.subscribeUpdates(({ update }) => updates.push(update));
    source.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), parentId: null });
    });
    source.transact(ADA, (transaction) => {
      transaction.insertText(id('sticky-idea'), 0, 'A', BODY);
    });
    source.transact(ADA, (transaction) => {
      transaction.insertText(id('sticky-idea'), 0, 'B', BODY);
    });
    const [creation, firstEdit, secondEdit] = updates;
    if (!creation || !firstEdit || !secondEdit) throw new Error('missing fixture update');
    for (const update of [secondEdit, secondEdit, creation]) {
      target.applyUpdate(update, RELAY);
      expect(internalsOf(target).doc.store.pendingStructs).not.toBeNull();
    }
    target.applyUpdate(firstEdit, RELAY);
    expect(internalsOf(target).doc.store.pendingStructs).toBeNull();
    expect(target.read().objects).toEqual(source.read().objects);
    source.destroy();
    target.destroy();
  });

  it('preserves a pending delete until the deleted creation arrives', () => {
    const source = new YjsDocumentStore({ clientId: 10 });
    const target = new YjsDocumentStore({ clientId: 20 });
    const updates: Uint8Array[] = [];
    source.subscribeUpdates(({ update }) => updates.push(update));
    source.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), parentId: null });
    });
    source.transact(ADA, (transaction) => transaction.deleteObject(id('sticky-idea')));
    const [creation, deletion] = updates;
    if (!creation || !deletion) throw new Error('missing fixture update');
    for (const update of [deletion, deletion]) {
      target.applyUpdate(update, RELAY);
      expect(internalsOf(target).doc.store.pendingDs).not.toBeNull();
    }
    target.applyUpdate(creation, RELAY);
    expect(internalsOf(target).doc.store.pendingDs).toBeNull();
    expect(target.read().objects).toEqual(source.read().objects);
    source.destroy();
    target.destroy();
  });
});

describe('finishRemoteUpdate', () => {
  it('throws a failed repair as it is when no listener failed', () => {
    const repairError = new Error('repair failed');
    expect(() => {
      finishRemoteUpdate(
        undefined,
        () => undefined,
        () => {
          throw repairError;
        },
      );
    }).toThrow(repairError);
  });
});
