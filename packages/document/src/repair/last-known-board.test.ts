import { describe, expect, it } from 'vitest';

import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import { LastKnownBoard } from './last-known-board.js';

describe('LastKnownBoard over a store', () => {
  it('reads a deleted object as the store last decoded it, until it comes back', () => {
    const store = createFixtureStore();
    const { lastKnown } = internalsOf(store);
    const sticky = store.get(id('sticky-idea'));
    store.transact(ADA, (transaction) => transaction.deleteObject(id('sticky-idea')));
    const board = new LastKnownBoard(store, lastKnown);
    expect(store.get(id('sticky-idea'))).toBeUndefined();
    expect(board.get(id('sticky-idea'))).toBe(sticky);
    store.transact(ADA, (transaction) => {
      if (sticky !== undefined) transaction.setObject(sticky);
    });
    expect(store.get(id('sticky-idea'))).toBeDefined();
    expect(lastKnown.get(id('sticky-idea'))).toBeUndefined();
  });

  it("lists a deleted group's children removed with it, beside the store's own", () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(id('group-diagram'));
      transaction.deleteObject(id('shape-box'));
    });
    const board = new LastKnownBoard(store, internalsOf(store).lastKnown);
    // shape-star stays on the board, a child of the deleted group, as a merge can leave it.
    expect([...board.references.childrenOf(id('group-diagram'))].sort()).toEqual([
      'shape-box',
      'shape-star',
    ]);
    expect(board.references.childrenOf(id('frame-plan'))).toBe(
      store.references.childrenOf(id('frame-plan')),
    );
    expect(board.references.childrenOf(null)).toBe(store.references.childrenOf(null));
  });

  it("answers the other indexes from the store's", () => {
    const store = createFixtureStore();
    const board = new LastKnownBoard(store, internalsOf(store).lastKnown);
    expect(board.references.topChildOf(null)).toBe(store.references.topChildOf(null));
    expect(board.references.connectorsAttachedTo(id('shape-box'))).toBe(
      store.references.connectorsAttachedTo(id('shape-box')),
    );
    expect(board.references.commentsAnchoredTo(id('image-photo'))).toBe(
      store.references.commentsAnchoredTo(id('image-photo')),
    );
  });
});
