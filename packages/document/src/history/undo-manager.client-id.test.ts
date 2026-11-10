import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { UpdateStampCheck } from '../meta/update-stamp-check.js';
import { ADA, fixtureObject, id, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Undo and redo write through `Y.UndoManager`, not through a `DocumentTransaction`, so they
// stamp on their own (fix round 1): after Yjs gives the document a new client id, a
// step that restores an object would otherwise write it unstamped, and the relay would refuse
// that client for good.

describe('undo after the document’s Yjs client id changed', () => {
  it('stamps under the new id before an undo or redo writes, so peers accept the step', () => {
    const store = new YjsDocumentStore({ clientId: 1 });
    const history = createHistory(store, ADA_ID);
    store.transact(ADA, (transaction) => {
      transaction.setObject(fixtureObject('sticky-idea', 'sticky'));
    });
    history.stopCapturing();
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(id('sticky-idea'));
    });
    // Yjs picks a new client id when it finds another client using the store's.
    internalsOf(store).doc.clientID = 2;
    const relay = new Y.Doc();
    Y.applyUpdate(relay, store.encodeState());

    const beforeUndo = store.encodeStateVector();
    expect(history.undo()).toBe(true);
    expect(store.get(id('sticky-idea'))).toBeDefined();
    const undoUpdate = store.encodeState(Y.encodeStateVector(relay));
    expect(new UpdateStampCheck(relay).check(undoUpdate)).toEqual({ kind: 'accepted' });
    Y.applyUpdate(relay, store.encodeState(beforeUndo));

    history.undo();
    internalsOf(store).doc.clientID = 3;
    expect(history.redo()).toBe(true);
    expect(
      new UpdateStampCheck(relay).check(store.encodeState(Y.encodeStateVector(relay))),
    ).toEqual({ kind: 'accepted' });

    const peer = new YjsDocumentStore();
    expect(() => {
      peer.applyUpdate(store.encodeState(), RELAY);
    }).not.toThrow();
    expect(peer.get(id('sticky-idea'))).toBeDefined();
    history.destroy();
  });
});
