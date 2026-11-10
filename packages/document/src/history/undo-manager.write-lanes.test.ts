// The undo guards tell histories on one client apart by write lane, through grouped
// steps, redo and a change of the document's client id.
import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId } from '@canvas/schema';

import { applyCommand, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { MAX_OBJECTS_PER_TRANSACTION } from '../commands/create-objects-parts.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { parseTransactionOrigin } from '../origin/transaction-origin.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { newShape } from './__fixtures__/creation-fixtures.js';
import { createHistory } from './undo-manager.js';
import { writeLanesOf } from './write-lanes.js';

const OPERATOR = 'user:ada' as PrincipalId;
type Colour = [number, number, number, number];
const GREEN: Colour = [0, 1, 0, 1];
const BLUE: Colour = [0, 0, 1, 1];
const LATER = { clock: () => NOW + 1_000, createId: () => 'unused' as ObjectId };

function agent(historyKey?: string) {
  return parseTransactionOrigin({
    kind: 'agent',
    principalId: 'agent:scout',
    operatorId: OPERATOR,
    ...(historyKey === undefined ? {} : { historyKey }),
  });
}

function recolour(store: YjsDocumentStore, id: string, fill: Colour, historyKey?: string): void {
  applyCommand(
    store,
    setStyleCommand,
    { changes: [{ id, style: { fill } }] },
    agent(historyKey),
    LATER,
  );
}

function fillOf(store: YjsDocumentStore, id: string): unknown {
  const object = store.get(id as ObjectId);
  return object?.type === 'shape' ? object.fill : undefined;
}

describe('undo guards per write lane', () => {
  it('keeps only the object another key touched when a grouped creation is undone', () => {
    const store = new YjsDocumentStore({ clientId: 4_541 });
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    try {
      const count = MAX_OBJECTS_PER_TRANSACTION + 2;
      const objects = [...Array(count).keys()].map((index) => newShape(`shape-${String(index)}`));
      const { ids } = applyCommand(
        store,
        createObjectsCommand,
        { objects },
        agent('agent-a'),
      ).result;
      const [first, second, last] = [ids[0], ids[1], ids.at(-1)] as [ObjectId, ObjectId, ObjectId];
      // One in the first part, one in the last.
      recolour(store, first, GREEN, 'agent-b');
      recolour(store, last, GREEN, 'agent-b');
      expect(historyA.undo()).toBe(true);
      expect(fillOf(store, first)).toEqual(GREEN);
      expect(fillOf(store, last)).toEqual(GREEN);
      expect(store.get(second)).toBeUndefined();
      expect(store.read().objects.size).toBeLessThan(count);
      expect(historyB.canUndo()).toBe(true);
    } finally {
      historyA.destroy();
      historyB.destroy();
      store.destroy();
    }
  });

  it('undoes a grouped creation whole when only its own key wrote to it since', () => {
    const store = new YjsDocumentStore({ clientId: 4_542 });
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    try {
      const count = MAX_OBJECTS_PER_TRANSACTION + 2;
      const objects = [...Array(count).keys()].map((index) => newShape(`shape-${String(index)}`));
      const before = store.read().objects.size;
      const { ids } = applyCommand(
        store,
        createObjectsCommand,
        { objects },
        agent('agent-a'),
      ).result;
      const [first] = ids;
      if (first === undefined) throw new Error('createObjects made no object');
      recolour(store, first, GREEN, 'agent-a');
      expect(historyA.undo()).toBe(true);
      expect(historyA.undo()).toBe(true);
      expect(store.read().objects.size).toBe(before);
    } finally {
      historyA.destroy();
      store.destroy();
    }
  });

  it("counts a key's own redo as its own, and protects another key's write after it", () => {
    const store = new YjsDocumentStore({ clientId: 4_543 });
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    try {
      applyCommand(store, createObjectCommand, { object: newShape('shape-new') }, agent('agent-a'));
      expect(historyA.undo()).toBe(true);
      expect(historyA.redo()).toBe(true);
      // The redo re-created the object in A's lane: A undoes it again.
      expect(historyA.undo()).toBe(true);
      expect(store.get('shape-new' as ObjectId)).toBeUndefined();
      expect(historyA.redo()).toBe(true);
      recolour(store, 'shape-new', GREEN, 'agent-b');
      expect(historyA.undo()).toBe(false);
      expect(fillOf(store, 'shape-new')).toEqual(GREEN);
      expect(historyA.canRedo()).toBe(false);
    } finally {
      historyA.destroy();
      historyB.destroy();
      store.destroy();
    }
  });

  it("keeps another key's fill when a redo would restore its own", () => {
    const store = new YjsDocumentStore({ clientId: 4_544 });
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    try {
      applyCommand(store, createObjectCommand, { object: newShape('shape-new') }, agent());
      recolour(store, 'shape-new', BLUE, 'agent-a');
      expect(historyA.undo()).toBe(true);
      recolour(store, 'shape-new', GREEN, 'agent-b');
      historyA.redo();
      expect(fillOf(store, 'shape-new')).toEqual(GREEN);
    } finally {
      historyA.destroy();
      store.destroy();
    }
  });

  it("tells keys apart after the document's client id changed", () => {
    const store = new YjsDocumentStore({ clientId: 4_545 });
    const historyA = createHistory(store, OPERATOR, { historyKey: 'agent-a' });
    const historyB = createHistory(store, OPERATOR, { historyKey: 'agent-b' });
    try {
      applyCommand(store, createObjectCommand, { object: newShape('shape-a') }, agent('agent-a'));
      applyCommand(store, createObjectCommand, { object: newShape('shape-b') }, agent('agent-a'));
      // Yjs picks a new client id when it finds another client using the store's.
      internalsOf(store).doc.clientID = 4_546;
      recolour(store, 'shape-b', GREEN, 'agent-b');
      expect(historyA.undo()).toBe(false);
      expect(fillOf(store, 'shape-b')).toEqual(GREEN);
      // A's own write under the new id is A's.
      recolour(store, 'shape-a', GREEN, 'agent-a');
      expect(historyA.undo()).toBe(true);
      expect(historyA.undo()).toBe(true);
      expect(store.get('shape-a' as ObjectId)).toBeUndefined();
    } finally {
      historyA.destroy();
      historyB.destroy();
      store.destroy();
    }
  });

  it('keeps no lane table on a document without a keyed history', () => {
    const store = new YjsDocumentStore({ clientId: 4_547 });
    const history = createHistory(store, OPERATOR);
    try {
      applyCommand(store, createObjectCommand, { object: newShape('shape-new') }, agent());
      recolour(store, 'shape-new', GREEN);
      const lanes = writeLanesOf(internalsOf(store).doc);
      expect(lanes.isKeyed).toBe(false);
      expect(lanes.size).toBe(0);
    } finally {
      history.destroy();
      store.destroy();
    }
  });
});
