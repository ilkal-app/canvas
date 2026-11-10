// A paste or import of thousands of objects is written in transactions of at most
// MAX_OBJECTS_PER_TRANSACTION objects, each under the collab client's 1 MiB chunk and each a
// valid board on its own, and the whole stays one undo step.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { MAX_OBJECTS_PER_TRANSACTION, orderByReferences } from './create-objects-parts.js';
import { createObjectsCommand } from './create-objects.js';
import type { NewObject } from './new-object-schema.js';

/** The fields `createObjects` generates, which a listed object leaves out. */
const GENERATED = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

/**
 * Objects of the large-board mix as `createObjects` lists them: ids local to the list.
 *
 * @param count - How many.
 * @returns The listed objects, frames before their children.
 */
function listed(count: number): NewObject[] {
  // The generator's objects are valid, so without the generated fields they are what
  // createObjects lists.
  return createLargeBoardObjects(count, 246).map(
    (object) =>
      Object.fromEntries(
        Object.entries(object).filter(([key]) => !GENERATED.has(key)),
      ) as unknown as NewObject,
  );
}

/**
 * The references among the board's objects that point at an object not on it.
 *
 * @param objects - The board's objects.
 * @returns One line per dangling reference.
 */
function danglingReferences(objects: ReadonlyMap<ObjectId, BoardObject>): string[] {
  const dangling: string[] = [];
  for (const object of objects.values()) {
    const targets = [object.parentId];
    if (object.type === 'connector') {
      for (const end of [object.from, object.to])
        if (end.kind === 'object') targets.push(end.objectId);
    }
    if (object.type === 'comment' && object.anchor.kind === 'object') {
      targets.push(object.anchor.objectId);
    }
    for (const target of targets) {
      if (target !== null && !objects.has(target)) dangling.push(`${object.id} → ${target}`);
    }
  }
  return dangling;
}

describe('orderByReferences', () => {
  it('puts parents, connector targets and anchors first, otherwise keeping the order', () => {
    const objects = createLargeBoardObjects(200, 7);
    const reversed = [...objects].reverse();
    const ordered = orderByReferences(reversed);
    expect(new Set(ordered)).toEqual(new Set(objects));
    const position = new Map(ordered.map((object, index) => [object.id, index]));
    for (const object of ordered) {
      if (object.parentId !== null) {
        expect(position.get(object.parentId)).toBeLessThan(position.get(object.id) ?? -1);
      }
    }
    expect(reversed).toEqual([...objects].reverse());
  });
});

describe('createObjects past MAX_OBJECTS_PER_TRANSACTION', { timeout: 30_000 }, () => {
  it('writes transactions of at most 1,000 objects, each under 1 MiB, and returns every id', () => {
    const store = new YjsDocumentStore();
    const updates: Uint8Array[] = [];
    store.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) updates.push(update);
    });
    const { result, changes } = applyCommand(store, createObjectsCommand, {
      objects: listed(2_500),
    });
    expect(MAX_OBJECTS_PER_TRANSACTION).toBe(1_000);
    expect(updates).toHaveLength(3);
    for (const update of updates) expect(update.byteLength).toBeLessThan(1024 * 1024);
    expect(result.ids).toHaveLength(2_500);
    expect(changes.created).toHaveLength(2_500);
    expect(new Set(changes.created)).toEqual(new Set(result.ids));
    expect(store.read().objects.size).toBe(2_500);
  });

  it('keeps a paste of 1,000 objects in one transaction', () => {
    const store = new YjsDocumentStore();
    let updates = 0;
    store.subscribeUpdates(() => {
      updates += 1;
    });
    applyCommand(store, createObjectsCommand, { objects: listed(1_000) });
    expect(updates).toBe(1);
  });

  it('leaves a peer a valid board after each transaction, children listed before parents', () => {
    const store = new YjsDocumentStore();
    const peer = new YjsDocumentStore();
    const peerWrites: Uint8Array[] = [];
    peer.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) peerWrites.push(update);
    });
    const problems: string[] = [];
    store.subscribeUpdates(({ update }) => {
      peer.applyUpdate(update, SYSTEM_ORIGIN);
      problems.push(...danglingReferences(peer.read().objects));
    });
    applyCommand(store, createObjectsCommand, { objects: listed(2_200).reverse() });
    expect(problems).toEqual([]);
    expect(peerWrites).toEqual([]);
    expect(peer.encodeStateVector()).toEqual(store.encodeStateVector());
  });

  it('is one undo step: undo removes every object, redo brings them all back', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA_ID);
    applyCommand(store, createObjectsCommand, { objects: listed(100) }, ADA, testEnvironment(1));
    applyCommand(store, createObjectsCommand, { objects: listed(2_500) }, ADA, testEnvironment(2));
    expect(store.read().objects.size).toBe(2_600);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(100);
    expect(history.redo()).toBe(true);
    expect(store.read().objects.size).toBe(2_600);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});
