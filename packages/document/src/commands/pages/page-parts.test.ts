// A page of more than MAX_OBJECTS_PER_TRANSACTION objects is duplicated and deleted in
// parts, the page's keys in the first part of a duplicate and the last of a delete, as
// one command, one change set and one undo step.
import { expect, it } from 'vitest';

import { DEFAULT_PAGE_ID, type PageId } from '@canvas/schema';

import { ADA_ID } from '../../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../../history/undo-manager.js';
import { SYSTEM_ORIGIN } from '../../origin/transaction-origin.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../../synthetic/large-board.js';
import { applyCommand, testEnvironment } from '../__fixtures__/command-fixtures.js';

import { addPageCommand } from './add-page.js';
import { deletePageCommand } from './delete-page.js';
import { duplicatePageCommand } from './duplicate-page.js';

it(
  'duplicates and deletes a page of 1,100 objects in parts, each one undo step',
  { timeout: 60_000 },
  () => {
    const store = new YjsDocumentStore({ clientId: 3_101 });
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of createLargeBoardObjects(1_100, 81)) transaction.setObject(object);
    });
    const history = createHistory(store, ADA_ID);
    applyCommand(store, addPageCommand, {}, undefined, testEnvironment(5));
    let transactions = 0;
    const stop = store.subscribeUpdates(() => (transactions += 1));

    const copy = applyCommand(
      store,
      duplicatePageCommand,
      { pageId: DEFAULT_PAGE_ID },
      undefined,
      testEnvironment(6),
    );
    const copyId: PageId = copy.result.pageId;
    expect(transactions).toBe(2);
    expect(copy.changes.created).toHaveLength(1_100);
    expect(copy.changes.pages).toEqual([copyId]);
    expect(store.read().pages.get(copyId)?.name).toBe('Page 1 copy');
    expect(store.read().objects.size).toBe(2_200);

    transactions = 0;
    const deleted = applyCommand(store, deletePageCommand, { pageId: DEFAULT_PAGE_ID });
    expect(transactions).toBe(2);
    expect(deleted.result.deletedIds).toHaveLength(1_100);
    expect(deleted.changes.pages).toEqual([DEFAULT_PAGE_ID]);
    expect(store.read().pages.has(DEFAULT_PAGE_ID)).toBe(false);
    expect(store.read().objects.size).toBe(1_100);
    stop();

    expect(history.undo()).toBe(true);
    expect(store.read().pages.has(DEFAULT_PAGE_ID)).toBe(true);
    expect(store.read().objects.size).toBe(2_200);
    expect(history.undo()).toBe(true);
    expect(store.read().pages.has(copyId)).toBe(false);
    expect(store.read().objects.size).toBe(1_100);
    store.destroy();
  },
);
