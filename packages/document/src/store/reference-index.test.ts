import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  createSiblingStore,
  FRAME_ID,
  objectId,
  rectangle,
} from '../z-order/__fixtures__/sibling-board.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { ADA, createFixtureStore, fixtureObject, id } from './__fixtures__/store-fixtures.js';
import type { DocumentTransaction } from './document-store.js';
import type { YjsDocumentStore } from './yjs-document-store.js';

describe('the store’s reverse indexes', () => {
  it('list children by parent, with the board root under null', () => {
    const store = createFixtureStore();
    expect([...store.references.childrenOf(id('group-diagram'))].sort()).toEqual([
      'shape-box',
      'shape-star',
    ]);
    expect([...store.references.childrenOf(id('frame-plan'))].sort()).toEqual([
      'group-diagram',
      'sticky-idea',
      'text-title',
    ]);
    expect(store.references.childrenOf(null).size).toBe(10);
    expect(store.references.childrenOf(id('shape-box')).size).toBe(0);
  });

  it('list connectors by target and comments by anchor', () => {
    const store = createFixtureStore();
    expect([...store.references.connectorsAttachedTo(id('shape-box'))]).toEqual(['connector-flow']);
    expect([...store.references.connectorsAttachedTo(id('sticky-idea'))]).toEqual([
      'connector-flow',
    ]);
    expect([...store.references.commentsAnchoredTo(id('image-photo'))]).toEqual([
      'comment-on-photo',
    ]);
    expect(store.references.commentsAnchoredTo(id('shape-box')).size).toBe(0);
  });

  it('follow reparenting, detaching, re-anchoring and deletion incrementally', () => {
    const store = createFixtureStore();
    const groupChildren = store.references.childrenOf(id('group-diagram'));
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('shape-star'), { parentId: id('frame-plan') });
      transaction.patchObject(id('connector-flow'), { to: { kind: 'point', x: 5, y: 5 } });
      transaction.patchObject(id('comment-free'), {
        anchor: { kind: 'object', objectId: id('shape-box'), offset: { x: 0, y: 0 } },
      });
      transaction.deleteObject(id('comment-on-photo'));
    });
    expect([...store.references.childrenOf(id('group-diagram'))]).toEqual(['shape-box']);
    expect(store.references.childrenOf(id('frame-plan')).has(id('shape-star'))).toBe(true);
    expect(store.references.connectorsAttachedTo(id('shape-box')).size).toBe(0);
    expect([...store.references.connectorsAttachedTo(id('sticky-idea'))]).toEqual([
      'connector-flow',
    ]);
    expect([...store.references.commentsAnchoredTo(id('shape-box'))]).toEqual(['comment-free']);
    expect(store.references.commentsAnchoredTo(id('image-photo')).size).toBe(0);
    expect([...groupChildren].sort()).toEqual(['shape-box', 'shape-star']);
  });

  it('keep children of a deleted parent findable under its id', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(id('group-diagram'));
      transaction.setObject({ ...fixtureObject('shape-box', 'shape'), id: id('shape-copy') });
    });
    expect([...store.references.childrenOf(id('group-diagram'))].sort()).toEqual([
      'shape-box',
      'shape-copy',
      'shape-star',
    ]);
  });
});

describe('the top child of each parent', () => {
  /**
   * The top child by a full sort, as `sortedSiblings` finds it.
   *
   * @param store - The store.
   * @param parentId - The parent.
   * @returns The top child's id.
   */
  function sortedTop(store: YjsDocumentStore, parentId: ObjectId | null): ObjectId | undefined {
    return sortedSiblings(store, parentId).at(-1);
  }

  it('is the child with the greatest key, ties broken by the greater id', () => {
    const store = createSiblingStore(4, { 1: 'a3', 3: 'a3' });
    expect(store.references.topChildOf(FRAME_ID)).toBe('s3');
    expect(store.references.topChildOf(null)).toBe('r1');
    expect(store.references.topChildOf(objectId('s0'))).toBeUndefined();
  });

  it('follows creations, moves down, reparenting and deletion of the top child', () => {
    const store = createSiblingStore(4);
    const steps: ((transaction: DocumentTransaction) => void)[] = [
      (transaction) => {
        transaction.setObject(rectangle('new', FRAME_ID, 'b00'));
      },
      (transaction) => {
        transaction.patchObject(objectId('new'), { z: 'Zz' });
      },
      (transaction) => {
        transaction.patchObject(objectId('s3'), { parentId: null });
      },
      (transaction) => transaction.deleteObject(objectId('s2')),
      (transaction) => {
        transaction.setObject(rectangle('s1', FRAME_ID, 'a9'));
      },
      (transaction) => {
        for (const id of ['new', 's0', 's1']) transaction.deleteObject(objectId(id));
      },
    ];
    for (const step of steps) {
      store.transact(ADA, step);
      for (const parentId of [FRAME_ID, null]) {
        expect(store.references.topChildOf(parentId)).toBe(sortedTop(store, parentId));
      }
    }
    expect(store.references.topChildOf(FRAME_ID)).toBeUndefined();
  });
});
