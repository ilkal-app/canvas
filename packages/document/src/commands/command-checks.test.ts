import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_ID, type ObjectId, type PageId } from '@canvas/schema';

import {
  ADA,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import { storedBoardOf } from './__fixtures__/stored-board.js';
import { checkObject, lockedDescendantOf, pagesOf, settledPages } from './command-checks.js';
import type { CommandError } from './command-error.js';
import type { BoardReader } from './command.js';

describe('checkObject', () => {
  it('refuses a candidate that is not an object, or has no id', () => {
    const store = createFixtureStore();
    for (const candidate of [null, 7, { type: 'shape' }, { id: 7 }]) {
      const errors: CommandError[] = [];
      expect(checkObject(store, candidate, errors)).toBeUndefined();
      expect(errors.map(({ code }) => code)).toContain('invalid-object');
    }
    store.destroy();
  });
});

describe('settledPages and pagesOf', () => {
  it('put a root object given no page on the first page of a reader without pages', () => {
    const store = createFixtureStore();
    // The reader lacks the child's group, and knows no pages and no default page.
    const board: BoardReader = {
      get: (objectId) => (objectId === 'group-diagram' ? undefined : store.get(objectId)),
      references: store.references,
    };
    expect([...pagesOf(board).keys()]).toEqual([DEFAULT_PAGE_ID]);
    const lifted = { ...fixtureObject('shape-box', 'shape'), parentId: null, pageId: null };
    expect(settledPages(board, [lifted])).toEqual([{ ...lifted, pageId: DEFAULT_PAGE_ID }]);
    store.destroy();
  });

  it('put it on the page a view of one page shows', () => {
    const store = createFixtureStore();
    const board: BoardReader = {
      get: (objectId) => store.get(objectId),
      references: store.references,
      defaultPageId: () => 'page-9' as PageId,
    };
    const created = { ...fixtureObject('shape-box', 'shape'), id: id('new'), parentId: null };
    expect(settledPages(board, [{ ...created, pageId: null }])).toEqual([
      { ...created, pageId: 'page-9' },
    ]);
    store.destroy();
  });
});

describe('lockedDescendantOf', () => {
  it('ends its walk at a parent cycle below the group', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    // A group in a cycle with its own child: a state only concurrent reparenting can produce.
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
    });
    const board = storedBoardOf(store);
    const loop = board.get('loop-a' as ObjectId);
    if (loop === undefined) throw new Error('no loop');
    expect(lockedDescendantOf(board, loop)).toBeUndefined();
    store.destroy();
  });
});
