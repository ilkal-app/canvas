import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE, type PageId } from '@canvas/schema';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { addPageCommand } from '../commands/pages/add-page.js';
import { deletePageCommand } from '../commands/pages/delete-page.js';
import { moveObjectsToPageCommand } from '../commands/pages/move-to-page.js';
import { StampingTransaction } from '../commands/stamping-transaction.js';

import {
  ADA,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from './__fixtures__/store-fixtures.js';
import type { ChangeSet } from './document-store.js';

describe('page change sets', () => {
  it('name the pages of a remote change, and join a page and object change into one', () => {
    const [a, b] = createSyncedPair();
    const seen: ChangeSet[] = [];
    b.subscribe((changes) => seen.push(changes));
    const pageId = applyCommand(a, addPageCommand, {}, undefined, testEnvironment(3)).result.pageId;
    exchange(a, b);
    expect(seen).toEqual([expect.objectContaining({ isLocal: false, created: [] })]);
    expect(seen[0]?.pages).toContain(pageId);
    a.destroy();
    b.destroy();
  });

  it('leave the pages out of a change set that changed none', () => {
    const store = createFixtureStore();
    const pageId = applyCommand(store, addPageCommand, {}).result.pageId;
    const { changes } = applyCommand(store, moveObjectsToPageCommand, {
      ids: ['image-photo'],
      pageId,
    });
    expect(changes.pages).toBeUndefined();
    expect(changes.updated).toContain('image-photo');
    store.destroy();
  });
});

describe('pages inside a transaction', () => {
  const creation = { createdBy: ADA.principalId, createdAt: 1 };
  const notes = { id: 'page-notes' as PageId, name: 'Notes', order: 'a5' };

  it('reads the pages as of now, its own writes included, through a stamping transaction too', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      expect([...transaction.pages().keys()]).toEqual(['page-1']);
      transaction.setPage(notes, creation);
      const stamping = new StampingTransaction(transaction);
      expect([...stamping.pages().keys()]).toEqual(['page-1', 'page-notes']);
    });
    store.destroy();
  });

  it('delivers the pages alone when the objects it wrote changed nothing in the end', () => {
    const store = createFixtureStore();
    const seen: ChangeSet[] = [];
    store.subscribe((changes) => seen.push(changes));
    store.transact(ADA, (transaction) => {
      transaction.setPage(notes, creation);
      transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), id: id('fleeting') });
      transaction.deleteObject(id('fleeting'));
    });
    expect(seen).toEqual([
      expect.objectContaining({
        created: [],
        updated: [],
        deleted: [],
        pages: ['page-1', 'page-notes'],
      }),
    ]);
    store.destroy();
  });

  it('writes the default page whole again once it was deleted', () => {
    const store = createFixtureStore();
    applyCommand(store, addPageCommand, { name: 'Two' }, undefined, testEnvironment(4));
    applyCommand(store, deletePageCommand, { pageId: 'page-1' });
    expect(store.read().pages.has(DEFAULT_PAGE.id)).toBe(false);
    store.transact(ADA, (transaction) => {
      transaction.setPage(DEFAULT_PAGE, creation);
    });
    expect(store.read().pages.get(DEFAULT_PAGE.id)).toEqual(DEFAULT_PAGE);
    store.destroy();
  });

  it('refuses a patch that changes an object id', () => {
    const store = createFixtureStore();
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('sticky-idea'), { id: id('other') } as never);
      });
    }).toThrow(RangeError);
    store.destroy();
  });
});
