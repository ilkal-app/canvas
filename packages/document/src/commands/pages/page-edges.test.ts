// The page commands on boards a store never shows a command (an order key that is not a
// key, a placement naming a page that is gone, a parent cycle), read through a board reader of
// the test's own.
import { describe, expect, it } from 'vitest';

import type { ObjectId, Page, PageId } from '@canvas/schema';

import { writeKeysRemotely } from '../../store/__fixtures__/remote-keys.js';
import {
  ADA,
  createFixtureStore,
  fixtureObject,
  id,
} from '../../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from '../__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from '../__fixtures__/stored-board.js';
import type { BoardReader } from '../command.js';

import { addPageCommand } from './add-page.js';
import { deletePageCommand } from './delete-page.js';
import { duplicatePageCommand } from './duplicate-page.js';
import { moveObjectsToPageCommand } from './move-to-page.js';
import { objectsOnPage, pageOfObject } from './page-support.js';
import { reorderPageCommand } from './reorder-page.js';

const page = (pageId: string, order: string): Page => ({
  id: pageId as PageId,
  name: pageId,
  order,
});

/**
 * The fixture store read with other pages than it stores.
 *
 * @param store - The store.
 * @param pages - The pages the reader shows, in order.
 * @returns The reader.
 */
function withPages(store: YjsDocumentStore, pages: readonly Page[]): BoardReader {
  return {
    get: (objectId) => store.get(objectId),
    references: store.references,
    readPages: () => new Map(pages.map((next) => [next.id, next])),
  };
}

const codes = (errors: readonly { readonly code: string }[]): string[] =>
  errors.map(({ code }) => code);

describe('page commands on order keys that are not keys', () => {
  it('refuse to add, duplicate or reorder next to a page whose key fits no key', () => {
    const store = createFixtureStore();
    const board = withPages(store, [page('page-1', 'a0'), page('page-2', 'legacy')]);
    expect(codes(refusalsOn(board, addPageCommand, {}))).toEqual(['unorderable-neighbours']);
    expect(codes(refusalsOn(board, duplicatePageCommand, { pageId: 'page-2' }))).toEqual([
      'unorderable-neighbours',
    ]);
    expect(
      codes(refusalsOn(board, reorderPageCommand, { pageId: 'page-1', after: 'page-2' })),
    ).toEqual(['unorderable-neighbours']);
    store.destroy();
  });
});

describe('reorderPage', () => {
  it('moves the last page between the other two', () => {
    const store = createFixtureStore();
    const second = applyCommand(store, addPageCommand, {}, undefined, testEnvironment(1)).result
      .pageId;
    const third = applyCommand(store, addPageCommand, {}, undefined, testEnvironment(2)).result
      .pageId;
    applyCommand(store, reorderPageCommand, { pageId: third, before: second });
    expect([...store.read().pages.keys()]).toEqual(['page-1', third, second]);
    store.destroy();
  });
});

describe('deletePage', () => {
  it('refuses a page whose deletion would detach a connector end below a parent cycle', () => {
    const store = createFixtureStore();
    applyCommand(store, addPageCommand, {}, undefined, testEnvironment(1));
    const group = fixtureObject('group-diagram', 'group');
    const connector = fixtureObject('connector-flow', 'connector');
    // Two groups parented to each other: a state only concurrent reparenting can produce.
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.setObject({
        ...connector,
        id: id('looped-wire'),
        parentId: id('loop-a'),
        pageId: null,
        from: { kind: 'object', objectId: id('image-photo'), anchor: null },
        to: { kind: 'point', x: 0, y: 0 },
      });
    });
    const board: BoardReader = { ...storedBoardOf(store), readPages: () => store.readPages() };
    expect(codes(refusalsOn(board, deletePageCommand, { pageId: 'page-1' }))).toEqual([
      'parent-cycle',
    ]);
    store.destroy();
  });
});

describe('page support', () => {
  it('shows an object naming a page that is gone on the first page', () => {
    const store = createFixtureStore();
    const board = withPages(store, [page('page-2', 'a0')]);
    expect(pageOfObject(board, store.get(id('image-photo')))).toBe('page-2');
    expect(pageOfObject(board, store.get(id('shape-box')))).toBe('page-2');
    expect(objectsOnPage(board, 'page-2' as PageId).roots).toContain('image-photo');
    expect(objectsOnPage(board, 'page-1' as PageId)).toEqual({ roots: [], all: [] });
    store.destroy();
  });

  it('finds no page for no object, a missing parent or a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
    });
    const board = storedBoardOf(store);
    expect(pageOfObject(board, undefined)).toBeUndefined();
    expect(pageOfObject(board, board.get(id('loop-a')))).toBeUndefined();
    const orphan = { ...group, id: id('orphan'), parentId: 'gone' as ObjectId };
    expect(pageOfObject(board, orphan)).toBeUndefined();
    store.destroy();
  });
});

describe('moveObjectsToPage keys', () => {
  it('keeps the keys of root objects above the page, and gives others fresh keys on top', () => {
    const store = createFixtureStore();
    const pageId = applyCommand(store, addPageCommand, {}, undefined, testEnvironment(1)).result
      .pageId;
    applyCommand(store, moveObjectsToPageCommand, { ids: ['line-divider'], pageId });
    expect(mustGet(store, 'line-divider').z).toBe('a3');
    applyCommand(store, moveObjectsToPageCommand, { ids: ['image-photo'], pageId });
    expect(mustGet(store, 'image-photo').z > 'a3').toBe(true);
    store.destroy();
  });

  it('refuses without writing when the top key of the root is not a key', () => {
    const store = createFixtureStore();
    const pageId = applyCommand(store, addPageCommand, {}, undefined, testEnvironment(1)).result
      .pageId;
    writeKeysRemotely(store, { 'comment-free': 'legacy' });
    const errors = expectRejected(store, moveObjectsToPageCommand, {
      ids: ['sticky-idea'],
      pageId,
    });
    expect(errors.map(({ code }) => code)).toEqual(['unorderable-neighbours']);
    store.destroy();
  });
});
