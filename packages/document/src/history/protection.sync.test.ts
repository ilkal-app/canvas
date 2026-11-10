import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';

import {
  create,
  createClients,
  moveBy,
  newShape,
  ORDERS,
  refill,
} from './__fixtures__/creation-fixtures.js';
import { mergeProtections, protectionOf } from './protection.js';

// (X2): when an undo or redo is used up because another person edited since what its
// step would change ('s PROTECT rule), `lastProtection()` says which objects and
// which Yjs client ids, so the app can name the person and outline the objects in their colour.

describe.each(ORDERS)('lastProtection ($name)', ({ adaClientId, bobClientId }) => {
  it('names the other client and the object when a creation is kept', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const shape = create(ada, newShape('shape-new'));
    link.deliver();
    refill(bob, shape, [0, 0, 1, 1]);
    link.deliver();

    expect(history.undo()).toBe(false);
    expect(history.lastProtection()).toEqual({ objectIds: [shape], writers: [bobClientId] });
  });

  it('names the other client when a field they wrote over is kept', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const shape = create(ada, newShape('shape-new'));
    history.stopCapturing();
    link.deliver();
    moveBy(ada, shape, 10, undefined, ADA);
    link.deliver();
    moveBy(bob, shape, 25);
    link.deliver();

    expect(history.undo()).toBe(false);
    expect(history.lastProtection()).toEqual({ objectIds: [shape], writers: [bobClientId] });
    // The next undo, of the creation, is kept too, and says so again.
    expect(history.undo()).toBe(false);
    expect(history.lastProtection()?.writers).toEqual([bobClientId]);
  });

  it('says nothing when the undo changed something, and forgets it on the next', () => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const kept = create(ada, newShape('shape-kept'));
    link.deliver();
    refill(bob, kept, [0, 0, 1, 1]);
    link.deliver();
    expect(history.undo()).toBe(false);
    expect(history.lastProtection()).toBeDefined();
    create(ada, newShape('shape-free'));
    expect(history.undo()).toBe(true);
    expect(history.lastProtection()).toBeUndefined();
  });

  it('says nothing for a redo that changed something', () => {
    const { ada, link, history } = createClients(adaClientId, bobClientId);
    create(ada, newShape('shape-new'));
    link.deliver();
    expect(history.undo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(history.lastProtection()).toBeUndefined();
  });
});

describe('mergeProtections', () => {
  const first = { objectIds: ['b' as ObjectId], writers: [7] };
  const second = { objectIds: ['a' as ObjectId, 'b' as ObjectId], writers: [3, 7] };

  it('joins the objects and the writers, sorted, and keeps either alone', () => {
    expect(mergeProtections(first, second)).toEqual({ objectIds: ['a', 'b'], writers: [3, 7] });
    expect(mergeProtections(undefined, second)).toBe(second);
    expect(mergeProtections(first, undefined)).toBe(first);
    expect(mergeProtections(undefined, undefined)).toBeUndefined();
  });
});

describe('protectionOf', () => {
  it('says nothing for a step recorded without a causal past', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    const step = {
      insertions: Y.createDeleteSet(),
      deletions: Y.createDeleteSet(),
      meta: new Map(),
    };
    expect(doc.transact((transaction) => protectionOf(transaction, step, objects))).toBe(undefined);
    doc.destroy();
  });
});
