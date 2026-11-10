import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { toYjs } from '../codec/object-codec.js';
import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { DocumentVersionError } from '../meta/document-version-error.js';

import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureBoard,
  id,
  RELAY,
} from './__fixtures__/store-fixtures.js';
import { internalsOf } from './internal.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from './yjs-document-store.js';

// The document's layout version: every store stamps the document's metadata with its
// first write, and a load of a board written before (objects, no metadata) or in a
// layout this build does not read fails with an error that names the relay's gate.

/**
 * Reads a store's stored metadata.
 *
 * @param store - The store.
 * @returns The value under the metadata key, if any.
 */
function storedMeta(store: YjsDocumentStore): unknown {
  return internalsOf(store).doc.getMap(META_MAP_NAME).get(DOCUMENT_META_KEY);
}

/**
 * Encodes the fixture board as a peer that writes no metadata would: the objects in the current
 * layout, nothing else.
 *
 * @param meta - Metadata to write beside them, if any.
 * @returns The document's state.
 */
function encodeBoard(meta?: unknown): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const objects = doc.getMap<unknown>(OBJECTS_MAP_NAME);
    for (const object of fixtureBoard().objects.values()) objects.set(object.id, toYjs(object));
    if (meta !== undefined) doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, meta);
  });
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Runs a call that must throw a version error and returns what the error says is wrong.
 *
 * @param call - The call.
 * @returns The error's problem.
 * @throws {Error} When the call throws something else, or nothing.
 */
function problemOf(call: () => void): DocumentVersionError['problem'] {
  try {
    call();
  } catch (error) {
    if (error instanceof DocumentVersionError) return error.problem;
    throw error;
  }
  throw new Error('the call did not throw');
}

describe('the document metadata', () => {
  it('is written with a store’s first write, and only then', () => {
    const store = new YjsDocumentStore();
    store.read();
    store.transact(ADA, () => undefined);
    expect(storedMeta(store)).toBeUndefined();
    store.transact(ADA, (transaction) => {
      transaction.setObject(fixtureBoard().objects.get(id('frame-plan')) as never);
    });
    expect(storedMeta(store)).toEqual(createDocumentMeta());
  });

  it('travels with the board, so a second store loads it', () => {
    const board = createFixtureStore().encodeState();
    const reader = new YjsDocumentStore();
    reader.applyUpdate(board, RELAY);
    expect(storedMeta(reader)).toEqual(createDocumentMeta());
    expect(reader.read().issues).toEqual([]);
  });
});

describe('a board this build cannot read', () => {
  it('fails to load when it has objects but no metadata, naming the relay’s gate', () => {
    const store = new YjsDocumentStore();
    const load = (): void => {
      store.applyUpdate(encodeBoard(), RELAY);
    };
    expect(load).toThrow(DocumentVersionError);
    expect(load).toThrow(/layout version gate/);
  });

  it('refuses every later write and update once loaded, and repairs nothing', () => {
    const store = new YjsDocumentStore();
    let updates = 0;
    store.subscribeUpdates(() => {
      updates += 1;
    });
    expect(
      problemOf(() => {
        store.applyUpdate(encodeBoard(), RELAY);
      }),
    ).toBe('unversioned');
    expect(updates).toBe(1);
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow(DocumentVersionError);
    expect(() => {
      store.applyUpdate(createFixtureStore().encodeState(), RELAY);
    }).toThrow(DocumentVersionError);
  });

  it('reports a listener’s error together with the version error, the listener’s first', () => {
    const store = new YjsDocumentStore();
    const failure = new Error('listener failed');
    store.subscribe(() => {
      throw failure;
    });
    let thrown: unknown;
    try {
      store.applyUpdate(encodeBoard(), RELAY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    const { errors } = thrown as AggregateError;
    expect(errors[0]).toBe(failure);
    expect(errors[1]).toBeInstanceOf(DocumentVersionError);
  });

  it('fails to load when its metadata names a layout or schema this build does not read', () => {
    const newer = { ...createDocumentMeta(), layoutVersion: 99 };
    const store = new YjsDocumentStore();
    const load = (): void => {
      store.applyUpdate(encodeBoard(newer), RELAY);
    };
    expect(problemOf(load)).toBe('unreadable-version');
    expect(() => {
      load();
    }).toThrow(JSON.stringify(newer));
  });

  it('fails when a peer later stamps a layout this build does not read', () => {
    const ada = createFixtureStore();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, ada.encodeState());
    peer.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 1, layoutVersion: 99 });
    expect(() => {
      ada.applyUpdate(Y.encodeStateAsUpdate(peer, ada.encodeStateVector()), RELAY);
    }).toThrow(DocumentVersionError);
  });
});

/**
 * Collects a store's local updates from now on.
 *
 * @param store - The store.
 * @returns The list the updates are pushed to.
 */
function localUpdatesOf(store: YjsDocumentStore): Uint8Array[] {
  const updates: Uint8Array[] = [];
  store.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) updates.push(update);
  });
  return updates;
}

describe('a stamp missing for a while in a stamped document', () => {
  it('does not fail while the update it depends on is still missing', () => {
    // Carol and Dave write concurrently; Bob, who has both, writes on Carol's object. A reader
    // that has Dave's update gets Bob's before Carol's: Yjs holds Bob's write back until
    // Carol's update arrives.
    const base = createFixtureStore().encodeState();
    const [carol, dave, bob, reader] = [30, 40, 20, 10].map((clientId) => {
      const store = new YjsDocumentStore({ clientId });
      store.applyUpdate(base, RELAY);
      return store;
    }) as [YjsDocumentStore, YjsDocumentStore, YjsDocumentStore, YjsDocumentStore];
    const [fromCarol, fromDave, fromBob] = [carol, dave, bob].map(localUpdatesOf) as [
      Uint8Array[],
      Uint8Array[],
      Uint8Array[],
    ];
    carol.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 1 });
    });
    dave.transact(BOB, (transaction) => {
      transaction.patchObject(id('text-title'), { x: 1 });
    });
    for (const update of [...fromCarol, ...fromDave]) bob.applyUpdate(update, RELAY);
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 2 });
    });
    for (const update of fromDave) reader.applyUpdate(update, RELAY);
    for (const update of fromBob) reader.applyUpdate(update, RELAY);
    expect(internalsOf(reader).doc.store.pendingStructs).not.toBeNull();
    for (const update of fromCarol) reader.applyUpdate(update, RELAY);
    expect(storedMeta(reader)).toEqual(createDocumentMeta());
    expect(reader.read().objects).toEqual(bob.read().objects);
  });

  it('does not fail when a forwarded sync reply removes a stamp that lost to one still on its way', () => {
    // Carol and Dave stamp concurrently and Dave's wins; Carol, having Dave's update, answers a
    // relay that already has it with her own items and her whole delete set, Carol's lost stamp
    // included. A reader that has neither gets that reply forwarded before Dave's update:
    // nothing is held back, and for a while no stamp is current.
    const base = createFixtureStore().encodeState();
    const [carol, dave, relay, reader] = [30, 40, 50, 10].map((clientId) => {
      const store = new YjsDocumentStore({ clientId });
      store.applyUpdate(base, RELAY);
      return store;
    }) as [YjsDocumentStore, YjsDocumentStore, YjsDocumentStore, YjsDocumentStore];
    const fromDave = localUpdatesOf(dave);
    carol.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 1 });
    });
    dave.transact(BOB, (transaction) => {
      transaction.patchObject(id('text-title'), { x: 1 });
    });
    for (const update of fromDave) {
      carol.applyUpdate(update, RELAY);
      relay.applyUpdate(update, RELAY);
    }
    const carolsReply = carol.encodeState(relay.encodeStateVector());
    reader.applyUpdate(carolsReply, RELAY);
    expect(storedMeta(reader)).toBeUndefined();
    expect(reader.read().objects.get(id('shape-box'))).toMatchObject({ x: 1 });
    for (const update of fromDave) reader.applyUpdate(update, RELAY);
    expect(storedMeta(reader)).toEqual(createDocumentMeta());
    expect(reader.read().objects).toEqual(carol.read().objects);
  });
});

describe('a writer that does not stamp', () => {
  it('is refused on a stamped board, naming the writer, although others stamped', () => {
    // A build from before still editing a board newer builds stamped: it writes a
    // per-field object and no stamp.
    const store = createFixtureStore();
    const oldBuild = new Y.Doc();
    oldBuild.clientID = 4_242;
    Y.applyUpdate(oldBuild, store.encodeState());
    const frame = fixtureBoard().objects.get(id('frame-plan'));
    oldBuild
      .getMap(OBJECTS_MAP_NAME)
      .set('old-frame', new Y.Map<unknown>(Object.entries({ ...frame, id: 'old-frame' })));
    let thrown: unknown;
    try {
      store.applyUpdate(Y.encodeStateAsUpdate(oldBuild, store.encodeStateVector()), RELAY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DocumentVersionError);
    expect(thrown).toMatchObject({ problem: 'unversioned', writers: [4_242] });
    expect(String(thrown)).toMatch(/client 4242.*layout version gate/s);
  });

  it('is refused on a new client syncing a board no writer stamped', () => {
    expect(
      problemOf(() => {
        new YjsDocumentStore().applyUpdate(encodeBoard(), RELAY);
      }),
    ).toBe('unversioned');
  });

  it('names every writer that did not stamp, in one error', () => {
    const store = createFixtureStore();
    const frame = fixtureBoard().objects.get(id('frame-plan'));
    const updates = [7_001, 7_002].map((clientId) => {
      const oldBuild = new Y.Doc();
      oldBuild.clientID = clientId;
      Y.applyUpdate(oldBuild, store.encodeState());
      const objectId = `old-${String(clientId)}`;
      oldBuild
        .getMap(OBJECTS_MAP_NAME)
        .set(objectId, new Y.Map<unknown>(Object.entries({ ...frame, id: objectId })));
      return Y.encodeStateAsUpdate(oldBuild, store.encodeStateVector());
    });
    let thrown: unknown;
    try {
      store.applyUpdate(Y.mergeUpdates(updates), RELAY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ problem: 'unversioned', writers: [7_001, 7_002] });
    expect(String(thrown)).toMatch(/clients 7001, 7002 without/);
  });
});

describe('a store whose Yjs client id changes', () => {
  it('stamps again under the new id, and peers accept its objects', () => {
    const store = createFixtureStore();
    const peer = new YjsDocumentStore();
    peer.applyUpdate(store.encodeState(), RELAY);
    const updates = localUpdatesOf(store);
    // Yjs picks a new client id when it finds another client using the store's.
    internalsOf(store).doc.clientID = 8_888;
    const frame = fixtureBoard().objects.get(id('frame-plan'));
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...frame, id: 'renumbered' } as never);
    });
    expect(() => {
      for (const update of updates) peer.applyUpdate(update, RELAY);
    }).not.toThrow();
    expect(peer.get(id('renumbered'))).toMatchObject({ id: 'renumbered' });
  });
});
