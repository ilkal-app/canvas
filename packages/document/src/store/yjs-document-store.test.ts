import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId, PrincipalId } from '@canvas/schema';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
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
import type { ChangeSet, DocumentUpdate } from './document-store.js';
import { DocumentWriteError } from './document-write-error.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from './yjs-document-store.js';

const AGENT = {
  kind: 'agent',
  principalId: 'agent:helper' as PrincipalId,
  operatorId: 'user:ada' as PrincipalId,
} as const;

describe('YjsDocumentStore reads', () => {
  it('starts empty', () => {
    const store = new YjsDocumentStore();
    expect(store.read().objects.size).toBe(0);
    expect(store.read().issues).toEqual([]);
  });

  it('caches the snapshot until the next change, sharing unchanged objects', () => {
    const store = createFixtureStore();
    const before = store.read();
    expect(store.read()).toBe(before);
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 5 });
    });
    const after = store.read();
    expect(after).not.toBe(before);
    expect(after.objects.get(id('frame-plan'))).toBe(before.objects.get(id('frame-plan')));
    expect(after.objects.get(id('shape-box'))).not.toBe(before.objects.get(id('shape-box')));
    expect(before.objects.get(id('shape-box'))).toMatchObject({ x: 0 });
  });

  it('seals the snapshot map and hands out only the reference queries', () => {
    const store = createFixtureStore();
    const objects = store.read().objects as Map<ObjectId, unknown>;
    expect(() => objects.set(id('x'), null)).toThrow(TypeError);
    expect(() => objects.delete(id('shape-box'))).toThrow(TypeError);
    expect(() => {
      objects.clear();
    }).toThrow(TypeError);
    expect(store.read().objects.size).toBe(15);
    expect(Object.keys(store.references).sort()).toEqual([
      'childrenOf',
      'commentsAnchoredTo',
      'connectorsAttachedTo',
      'instancesOf',
      'topChildOf',
    ]);
    expect(Object.isFrozen(store.references)).toBe(true);
  });

  it('hands out deep-frozen objects, so no caller can change the document behind Yjs', () => {
    const store = createFixtureStore();
    const shape = store.get(id('shape-box'));
    expect(Object.isFrozen(shape)).toBe(true);
    expect(shape?.type === 'shape' && Object.isFrozen(shape.stroke?.color)).toBe(true);
    expect(Object.isFrozen(store.read())).toBe(true);
  });

  it('reports entries it cannot read instead of throwing, and reads the rest', () => {
    const store = createFixtureStore();
    // A newer peer, which stamps the document as every writer does, adds a type this build
    // does not know.
    const foreign = new Y.Doc();
    Y.applyUpdate(foreign, store.encodeState());
    foreign.transact(() => {
      foreign.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
      foreign
        .getMap(OBJECTS_MAP_NAME)
        .set('widget-1', new Y.Map([['identity', { id: 'widget-1', type: 'widget' }]]));
    });
    store.applyUpdate(Y.encodeStateAsUpdate(foreign, store.encodeStateVector()), RELAY);
    const snapshot = store.read();
    expect(snapshot.objects.size).toBe(15);
    expect(snapshot.issues).toEqual([
      expect.objectContaining({ code: 'unknown-type', key: 'widget-1' }),
    ]);
    expect(store.get(id('widget-1'))).toBeUndefined();
  });
});

describe('YjsDocumentStore writes', () => {
  it('validates every object before writing, and writes nothing when one is invalid', () => {
    const store = new YjsDocumentStore();
    const frame = fixtureObject('frame-plan', 'frame');
    let error: unknown;
    try {
      store.transact(ADA, (transaction) => {
        transaction.setObject({ ...frame, width: -1 });
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentWriteError);
    expect((error as DocumentWriteError).issues).toEqual([
      expect.objectContaining({ code: 'invalid-object', objectId: 'frame-plan', path: ['width'] }),
    ]);
    expect(store.read().objects.size).toBe(0);
  });

  it('patches only the given fields and validates the merged object', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('sticky-idea'), { color: [0.5, 0.5, 1, 1], x: 60 });
    });
    expect(store.get(id('sticky-idea'))).toEqual({
      ...fixtureObject('sticky-idea', 'sticky'),
      color: [0.5, 0.5, 1, 1],
      x: 60,
    });
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('sticky-idea'), { autoWidth: true });
      });
    }).toThrow(DocumentWriteError);
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('sticky-idea'), { crop: { x: 0, y: 0, width: 1, height: 1 } });
      });
    }).toThrow(DocumentWriteError);
  });

  it('replaces text, runs, labels and networks given in a patch', () => {
    const store = createFixtureStore();
    const bold = { ...BODY, weight: 700 as const };
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('text-title'), {
        text: 'Plan',
        runs: [{ length: 4, style: bold }],
      });
      transaction.patchObject(id('shape-star'), {
        label: { text: 'Go', runs: [{ length: 2, style: BODY }] },
      });
      transaction.patchObject(id('path-squiggle'), { vertices: [], segments: [] });
    });
    expect(store.get(id('text-title'))).toMatchObject({
      text: 'Plan',
      runs: [{ length: 4, style: bold }],
    });
    expect(store.get(id('shape-star'))).toMatchObject({ label: { text: 'Go' } });
    expect(store.get(id('path-squiggle'))).toMatchObject({ vertices: [], segments: [] });
  });

  it('refuses a label whose runs split a surrogate pair, naming the field', () => {
    const store = createFixtureStore();
    let error: unknown;
    try {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('shape-box'), {
          label: {
            text: 'x😀y',
            runs: [
              { length: 2, style: BODY },
              { length: 2, style: { ...BODY, italic: true } },
            ],
          },
        });
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentWriteError);
    expect((error as DocumentWriteError).issues).toEqual([
      expect.objectContaining({ objectId: 'shape-box', path: ['label', 'runs', 1] }),
    ]);
    expect(store.get(id('shape-box'))).toMatchObject({ label: { text: 'API' } });
  });

  it('refuses a patch of the id or type, and edits of objects that do not exist', () => {
    const store = createFixtureStore();
    const patchType = { type: 'frame' } as unknown as Record<string, never>;
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('shape-box'), patchType);
      });
    }).toThrow(RangeError);
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('missing'), { x: 1 });
      });
    }).toThrow(RangeError);
  });

  it('replaces an object of another type under the same id as a new entry', () => {
    const store = createFixtureStore();
    const frame = fixtureObject('frame-plan', 'frame');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('shape-star', 'shape'), id: frame.id });
    });
    expect(store.get(frame.id)).toMatchObject({ type: 'shape', kind: 'star' });
  });

  it('deletes one object without cascading', () => {
    const store = createFixtureStore();
    const wasDeleted = store.transact(ADA, (transaction) =>
      transaction.deleteObject(id('group-diagram')),
    );
    expect(wasDeleted).toBe(true);
    expect(store.get(id('group-diagram'))).toBeUndefined();
    expect(store.get(id('shape-box'))).toBeDefined();
    expect(
      store.transact(ADA, (transaction) => transaction.deleteObject(id('group-diagram'))),
    ).toBe(false);
  });

  it('shows a transaction its own writes before they are committed', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 99 });
      expect(transaction.get(id('shape-box'))).toMatchObject({ x: 99 });
      expect(store.get(id('shape-box'))).toMatchObject({ x: 0 });
      expect(transaction.get(id('missing'))).toBeUndefined();
    });
  });
});

describe('YjsDocumentStore transactions', () => {
  it('returns what the mutation returns and closes the transaction afterwards', () => {
    const store = createFixtureStore();
    let kept: Parameters<Parameters<YjsDocumentStore['transact']>[1]>[0] | undefined;
    const result = store.transact(ADA, (transaction) => {
      kept = transaction;
      return 42;
    });
    expect(result).toBe(42);
    expect(() => kept?.get(id('shape-box'))).toThrow('The transaction has ended');
  });

  it('refuses nested transactions, writes from listeners, and invalid origins', () => {
    const store = createFixtureStore();
    expect(() => {
      store.transact(ADA, () => {
        store.transact(ADA, () => undefined);
      });
    }).toThrow('A transaction is already running');
    store.subscribe(() => {
      store.transact(ADA, () => undefined);
    });
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('shape-box'), { x: 1 });
      });
    }).toThrow('A transaction is already running');
    expect(() => {
      store.transact({ kind: 'user', principalId: 'agent:x' as PrincipalId }, () => undefined);
    }).toThrow(RangeError);
  });

  it('delivers one change set per transaction with its origin', () => {
    const store = createFixtureStore();
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    store.transact(AGENT, (transaction) => {
      transaction.setObject({ ...fixtureObject('comment-free', 'comment'), id: id('comment-new') });
      transaction.patchObject(id('shape-box'), { x: 3 });
      transaction.insertText(id('shape-box'), 0, 'An ', BODY);
      transaction.setVertex(id('path-squiggle'), { id: 'v1', x: 1, y: 1, mirror: 'none' });
      transaction.deleteObject(id('comment-free'));
    });
    expect(changes).toEqual([
      {
        origin: AGENT,
        isLocal: true,
        created: ['comment-new'],
        updated: ['path-squiggle', 'shape-box'],
        deleted: ['comment-free'],
      },
    ]);
  });

  it('delivers no change set for an entry created and deleted in one transaction', () => {
    const store = createFixtureStore();
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('comment-free', 'comment'), id: id('fleeting') });
      transaction.deleteObject(id('fleeting'));
    });
    expect(changes).toEqual([]);
    expect(store.get(id('fleeting'))).toBeUndefined();
  });

  it('delivers a second, local system change set when Yjs cleans up merged formatting', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { weight: 700 });
    });
    bob.transact(BOB, (transaction) => {
      transaction.formatText(id('sticky-idea'), 0, 4, { weight: 700 });
    });
    const changes: ChangeSet[] = [];
    const updates: DocumentUpdate[] = [];
    bob.subscribe((change) => changes.push(change));
    bob.subscribeUpdates((update) => updates.push(update));
    bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY);
    expect(changes.map(({ origin, isLocal, updated }) => [origin, isLocal, updated])).toEqual([
      [RELAY, false, ['sticky-idea']],
      [SYSTEM_ORIGIN, true, ['sticky-idea']],
    ]);
    expect(updates.map(({ origin, isLocal }) => [origin, isLocal])).toEqual([
      [RELAY, false],
      [SYSTEM_ORIGIN, true],
    ]);
  });

  it('delivers remote change sets and updates with the origin given to applyUpdate', () => {
    const source = createFixtureStore();
    const target = new YjsDocumentStore();
    const changes: ChangeSet[] = [];
    const updates: DocumentUpdate[] = [];
    target.subscribe((change) => changes.push(change));
    target.subscribeUpdates((update) => updates.push(update));
    target.applyUpdate(source.encodeState(), RELAY);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ origin: RELAY, isLocal: false, updated: [], deleted: [] });
    expect(changes[0]?.created).toHaveLength(15);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ origin: RELAY, isLocal: false });
  });

  it('streams each local update so a peer can apply it', () => {
    const [first, second] = [createFixtureStore(), new YjsDocumentStore()];
    second.applyUpdate(first.encodeState(), RELAY);
    const updates: DocumentUpdate[] = [];
    const stop = first.subscribeUpdates((update) => updates.push(update));
    first.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-plan'), { clip: false });
    });
    stop();
    first.transact(ADA, (transaction) => {
      transaction.patchObject(id('frame-plan'), { clip: true });
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ origin: ADA, isLocal: true });
    second.applyUpdate(updates[0]?.update ?? new Uint8Array(), RELAY);
    expect(second.get(id('frame-plan'))).toMatchObject({ clip: false });
  });

  it('calls every listener even when one throws, then rethrows', () => {
    const store = createFixtureStore();
    const calls: string[] = [];
    store.subscribe(() => {
      throw new Error('listener failed');
    });
    store.subscribe(() => calls.push('second'));
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('shape-box'), { x: 1 });
      });
    }).toThrow('listener failed');
    expect(calls).toEqual(['second']);
    expect(store.get(id('shape-box'))).toMatchObject({ x: 1 });
  });

  it('encodes only what a peer lacks given its state vector', () => {
    const store = createFixtureStore();
    const vector = store.encodeStateVector();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-box'), { x: 1 });
    });
    expect(store.encodeState(vector).byteLength).toBeLessThan(store.encodeState().byteLength / 10);
  });

  it('cannot be used after destroy', () => {
    const store = createFixtureStore();
    store.destroy();
    store.destroy();
    expect(() => store.read()).toThrow('destroyed');
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow('destroyed');
    expect(() => store.encodeState()).toThrow('destroyed');
  });
});
