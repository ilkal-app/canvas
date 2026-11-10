// Slice 3b: stamp uses the last whole-object write without decoding it again.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  ADA,
  BODY,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet, NOW, testEnvironment } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand } from './create-objects.js';
import { StampingTransaction } from './stamping-transaction.js';

interface StampCalls {
  readonly gets: ObjectId[];
  readonly patches: { readonly id: ObjectId; readonly patch: ObjectPatch }[];
}

/**
 * Records only the inner calls made by stamp, after all command writes have finished.
 *
 * @param store - The real document store.
 * @param now - The time to stamp.
 * @param write - The command's writes before stamping.
 * @returns The inner calls made by stamping.
 */
function stampAfterWrites(
  store: YjsDocumentStore,
  now: number,
  write: (transaction: StampingTransaction) => void,
): StampCalls {
  const gets: ObjectId[] = [];
  const patches: { id: ObjectId; patch: ObjectPatch }[] = [];
  store.transact(ADA, (transaction) => {
    const inner: DocumentTransaction = {
      ...transaction,
      origin: transaction.origin,
      get: (objectId) => {
        gets.push(objectId);
        return transaction.get(objectId);
      },
      patchObject: (objectId, patch) => {
        patches.push({ id: objectId, patch });
        transaction.patchObject(objectId, patch);
      },
      setObject: (object) => {
        transaction.setObject(object);
      },
      deleteObject: (objectId) => transaction.deleteObject(objectId),
      insertText: (objectId, index, content, style) => {
        transaction.insertText(objectId, index, content, style);
      },
    };
    const stamping = new StampingTransaction(inner);
    write(stamping);
    gets.length = 0;
    patches.length = 0;
    stamping.stamp(now);
  });
  return { gets, patches };
}

describe('StampingTransaction last-write stamps', () => {
  it('does not read or patch N newly written objects already carrying now', () => {
    const store = createFixtureStore();
    const template = fixtureObject('shape-box', 'shape');
    const objectIds: ObjectId[] = [];
    for (let index = 0; index < 32; index += 1) objectIds.push(id('fresh-shape-' + String(index)));
    const calls = stampAfterWrites(store, NOW, (stamping) => {
      for (const objectId of objectIds) {
        stamping.setObject({ ...template, id: objectId, updatedAt: NOW });
      }
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual([]);
    for (const objectId of objectIds) expect(mustGet(store, objectId).updatedAt).toBe(NOW);
  });

  it('patches a whole write with an old stamp to now without reading it', () => {
    const store = createFixtureStore();
    const template = fixtureObject('shape-box', 'shape');
    const objectIds = [id('fresh-old-a'), id('fresh-old-b')];
    const calls = stampAfterWrites(store, NOW, (stamping) => {
      for (const objectId of objectIds) {
        stamping.setObject({ ...template, id: objectId, updatedAt: NOW - 100 });
      }
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual(
      objectIds.map((objectId) => ({ id: objectId, patch: { updatedAt: NOW } })),
    );
    for (const objectId of objectIds) expect(mustGet(store, objectId).updatedAt).toBe(NOW);
  });

  it('forces a reference rewrite past its prior stamp without reading it', () => {
    const store = createFixtureStore();
    const before = mustGet(store, 'shape-box');
    const calls = stampAfterWrites(store, before.updatedAt, (stamping) => {
      stamping.setObject({ ...before, x: before.x + 1 });
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual([{ id: before.id, patch: { updatedAt: before.updatedAt + 1 } }]);
    expect(mustGet(store, 'shape-box').updatedAt).toBe(before.updatedAt + 1);
  });

  it('clamps a forced reference stamp at MAX_SAFE_INTEGER without reading it', () => {
    const store = createFixtureStore();
    const original = mustGet(store, 'shape-box');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(original.id, { updatedAt: Number.MAX_SAFE_INTEGER });
    });
    const before = mustGet(store, 'shape-box');
    const calls = stampAfterWrites(store, NOW, (stamping) => {
      stamping.setObject({ ...before, x: before.x + 1 });
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual([]);
    expect(mustGet(store, 'shape-box').updatedAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reads once after a last patch that leaves updatedAt unknown', () => {
    const store = createFixtureStore();
    const before = fixtureObject('image-photo', 'image');
    const calls = stampAfterWrites(store, NOW + 1, (stamping) => {
      stamping.setObject({ ...before, updatedAt: NOW });
      stamping.patchObject(before.id, { opacity: 0.5 });
    });
    expect(calls.gets).toEqual([before.id]);
    expect(calls.patches).toEqual([{ id: before.id, patch: { updatedAt: NOW + 1 } }]);
    expect(mustGet(store, 'image-photo')).toMatchObject({ opacity: 0.5, updatedAt: NOW + 1 });
  });

  it('reads a text-only write once and skips stamping when it cannot decode the object', () => {
    const store = createFixtureStore();
    const objectId = id('text-title');
    const gets: ObjectId[] = [];
    const patches: ObjectId[] = [];
    store.transact(ADA, (transaction) => {
      const inner: DocumentTransaction = {
        ...transaction,
        origin: transaction.origin,
        get: (id) => {
          gets.push(id);
          return undefined;
        },
        deleteText: (id, index, length) => {
          transaction.deleteText(id, index, length);
        },
        patchObject: (id, patch) => {
          patches.push(id);
          transaction.patchObject(id, patch);
        },
      };
      const stamping = new StampingTransaction(inner);
      stamping.deleteText(objectId, 0, 1);
      stamping.stamp(NOW);
    });
    expect(gets).toEqual([objectId]);
    expect(patches).toEqual([]);
  });

  it('neither reads nor patches an object deleted after its write', () => {
    const store = createFixtureStore();
    const before = mustGet(store, 'shape-box');
    const calls = stampAfterWrites(store, NOW, (stamping) => {
      stamping.setObject({ ...before, updatedAt: NOW - 1 });
      expect(stamping.deleteObject(before.id)).toBe(true);
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual([]);
    expect(store.get(before.id)).toBeUndefined();
  });

  it('uses the new whole write after deleting and setting the same id', () => {
    for (const updatedAt of [NOW, NOW - 1]) {
      const store = createFixtureStore();
      const before = mustGet(store, 'shape-box');
      const calls = stampAfterWrites(store, NOW, (stamping) => {
        expect(stamping.deleteObject(before.id)).toBe(true);
        stamping.setObject({ ...before, updatedAt });
      });
      expect(calls.gets).toEqual([]);
      expect(calls.patches).toEqual(
        updatedAt === NOW ? [] : [{ id: before.id, patch: { updatedAt: NOW } }],
      );
      expect(mustGet(store, before.id).updatedAt).toBe(NOW);
    }
  });

  it('stamps a text edit after a whole write without reading the object', () => {
    const store = createFixtureStore();
    const before = fixtureObject('sticky-idea', 'sticky');
    const calls = stampAfterWrites(store, NOW, (stamping) => {
      stamping.setObject({ ...before, updatedAt: NOW - 1 });
      stamping.insertText(before.id, 0, 'A ', BODY);
    });
    expect(calls.gets).toEqual([]);
    expect(calls.patches).toEqual([{ id: before.id, patch: { updatedAt: NOW } }]);
    expect(mustGet(store, before.id)).toMatchObject({ text: 'A Ship the beta 😀', updatedAt: NOW });
  });
});

describe('runCommand split createObjects stamps', { timeout: 30_000 }, () => {
  it('preserves createdAt and stamps all 1,200 pasted objects with the environment clock', () => {
    const store = new YjsDocumentStore();
    let parts = 0;
    store.subscribeUpdates(({ isLocal }) => {
      if (isLocal) parts += 1;
    });
    const objects = [];
    for (let index = 0; index < 1_200; index += 1) {
      objects.push({
        type: 'shape' as const,
        id: 'listed-' + String(index),
        parentId: null,
        x: (index % 40) * 50,
        y: Math.floor(index / 40) * 50,
        width: 40,
        height: 30,
        kind: 'rectangle' as const,
        stroke: null,
        fill: [0.2, 0.4, 0.8, 1] as [number, number, number, number],
        cornerRadius: 0,
        sides: 4,
        label: null,
      });
    }
    const { result } = applyCommand(
      store,
      createObjectsCommand,
      { objects },
      ADA,
      testEnvironment(),
    );
    expect(parts).toBe(2);
    expect(result.ids).toHaveLength(1_200);
    expect(store.read().objects.size).toBe(1_200);
    for (const objectId of result.ids) {
      expect(mustGet(store, objectId)).toMatchObject({ createdAt: NOW, updatedAt: NOW });
    }
  });
});
