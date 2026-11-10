import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { toYjs } from '../codec/object-codec.js';
import { MalformedUpdateError, UpdateDepthError } from '../index.js';
import { DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import { DocumentVersionError } from '../meta/document-version-error.js';

import { ADA, fixtureObject, id, RELAY } from './__fixtures__/store-fixtures.js';
import type { ChangeSet, DocumentUpdate } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

interface StepOptions {
  readonly isSilent?: boolean;
  readonly yieldToBrowser: () => Promise<void>;
}
type SteppedStore = YjsDocumentStore & {
  applyUpdateInSteps(update: Uint8Array, origin: typeof RELAY, options: StepOptions): Promise<void>;
};

function applyInSteps(
  store: YjsDocumentStore,
  bytes: Uint8Array,
  options: StepOptions,
): Promise<void> {
  return (store as SteppedStore).applyUpdateInSteps(bytes, RELAY, options);
}

function orphanUpdate(): Uint8Array {
  const source = new YjsDocumentStore();
  source.transact(ADA, (transaction) => {
    transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), parentId: id('gone') });
  });
  const bytes = source.encodeState();
  source.destroy();
  return bytes;
}

function nestedUpdate(): Uint8Array {
  const doc = new Y.Doc();
  let value: unknown = 'leaf';
  for (let index = 0; index < 129; index += 1) value = { child: value };
  doc.getMap('auxiliary').set('value', value);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

function unversionedUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('objects').set('sticky-idea', toYjs(fixtureObject('sticky-idea', 'sticky')));
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

function unreadableUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('objects').set('sticky-idea', toYjs(fixtureObject('sticky-idea', 'sticky')));
  doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { layoutVersion: 999, schemaVersion: 999 });
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

function observe(store: YjsDocumentStore) {
  const changes: ChangeSet[] = [];
  const updates: DocumentUpdate[] = [];
  store.subscribe((change) => changes.push(change));
  store.subscribeUpdates((update) => updates.push(update));
  return { changes, updates };
}

describe('stepped document update acceptance', () => {
  it.each([false, true])(
    'matches ordinary apply and exposes both task boundaries (silent=%s)',
    async (isSilent) => {
      const bytes = orphanUpdate();
      const ordinary = new YjsDocumentStore({ clientId: 10 });
      const stepped = new YjsDocumentStore({ clientId: 10 });
      const expected = observe(ordinary);
      const actual = observe(stepped);
      ordinary.applyUpdate(bytes, RELAY, { isSilent });
      const seen: { isPresent: boolean; changes: number; updates: number; state: Uint8Array }[] =
        [];
      const yieldToBrowser = vi.fn(() => {
        seen.push({
          isPresent: stepped.get(id('sticky-idea')) !== undefined,
          changes: actual.changes.length,
          updates: actual.updates.length,
          state: stepped.encodeState(),
        });
        return Promise.resolve();
      });
      await applyInSteps(stepped, bytes, { isSilent, yieldToBrowser });
      expect(yieldToBrowser).toHaveBeenCalledTimes(2);
      expect(
        seen.map(({ isPresent, changes, updates }) => ({ isPresent, changes, updates })),
      ).toEqual([
        { isPresent: false, changes: 0, updates: 0 },
        { isPresent: true, changes: 1, updates: isSilent ? 0 : 1 },
      ]);
      expect(seen[1]?.state).not.toEqual(stepped.encodeState());
      expect(stepped.read()).toEqual(ordinary.read());
      expect(actual.changes).toEqual(expected.changes);
      expect(actual.updates).toEqual(expected.updates);
      expect(stepped.get(id('sticky-idea'))?.parentId).toBeNull();
      ordinary.destroy();
      stepped.destroy();
    },
  );

  it.each([
    ['malformed', new Uint8Array([1]), MalformedUpdateError],
    ['too deep', nestedUpdate(), UpdateDepthError],
  ])('rejects %s bytes before the first yield or mutation', async (name, bytes, errorType) => {
    expect(name).toBeTruthy();
    const store = new YjsDocumentStore();
    const before = store.encodeState();
    const observed = observe(store);
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    await expect(applyInSteps(store, bytes, { yieldToBrowser })).rejects.toBeInstanceOf(errorType);
    expect(yieldToBrowser).not.toHaveBeenCalled();
    expect(store.encodeState()).toEqual(before);
    expect(observed).toEqual({ changes: [], updates: [] });
    store.destroy();
  });

  it.each([unversionedUpdate(), unreadableUpdate()])(
    'rejects an unreadable version, skips repair, and poisons the store',
    async (bytes) => {
      const store = new YjsDocumentStore();
      const observed = observe(store);
      const yieldToBrowser = vi.fn(() => Promise.resolve());
      await expect(applyInSteps(store, bytes, { yieldToBrowser })).rejects.toBeInstanceOf(
        DocumentVersionError,
      );
      expect(yieldToBrowser).toHaveBeenCalledTimes(1);
      expect(observed.changes).toHaveLength(1);
      expect(observed.updates).toHaveLength(1);
      expect(() => {
        store.transact(ADA, () => undefined);
      }).toThrow(DocumentVersionError);
      store.destroy();
    },
  );

  it('repairs references before rejecting a change listener error', async () => {
    const store = new YjsDocumentStore();
    const failure = new Error('listener failed');
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
      if (calls === 1) throw failure;
    });
    await expect(
      applyInSteps(store, orphanUpdate(), { yieldToBrowser: () => Promise.resolve() }),
    ).rejects.toBe(failure);
    expect(calls).toBe(2);
    expect(store.get(id('sticky-idea'))?.parentId).toBeNull();
    store.destroy();
  });

  it('preserves the listener and version failures in an AggregateError', async () => {
    const store = new YjsDocumentStore();
    const failure = new Error('listener failed');
    store.subscribe(() => {
      throw failure;
    });
    let rejected: unknown;
    try {
      await applyInSteps(store, unversionedUpdate(), {
        yieldToBrowser: () => Promise.resolve(),
      });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(AggregateError);
    expect((rejected as AggregateError).errors).toEqual([
      failure,
      expect.any(DocumentVersionError),
    ]);
    store.destroy();
  });

  it('blocks every competing mutation while a yield is pending', async () => {
    const store = new YjsDocumentStore();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = applyInSteps(store, orphanUpdate(), {
      yieldToBrowser: () => pending,
    });
    const before = store.encodeState();
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow();
    expect(() => {
      store.applyUpdate(orphanUpdate(), RELAY);
    }).toThrow();
    await expect(
      applyInSteps(store, orphanUpdate(), { yieldToBrowser: () => Promise.resolve() }),
    ).rejects.toThrow();
    expect(store.encodeState()).toEqual(before);
    release?.();
    await first;
    store.destroy();
  });

  it('settles after destroy during a yield and delivers no later change set', async () => {
    const store = new YjsDocumentStore();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const changes = vi.fn();
    store.subscribe(changes);
    const applying = applyInSteps(store, orphanUpdate(), {
      yieldToBrowser: () => pending,
    });
    store.destroy();
    release?.();
    await expect(
      Promise.race([
        applying.then(
          () => 'settled',
          () => 'settled',
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => {
            resolve('timed out');
          }, 100),
        ),
      ]),
    ).resolves.toBe('settled');
    expect(changes).not.toHaveBeenCalled();
  });
});
