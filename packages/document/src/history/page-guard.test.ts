import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { addPageCommand } from '../commands/pages/add-page.js';
import { deletePageCommand } from '../commands/pages/delete-page.js';
import { duplicatePageCommand } from '../commands/pages/duplicate-page.js';
import { moveObjectsToPageCommand } from '../commands/pages/move-to-page.js';
import { renamePageCommand } from '../commands/pages/rename-page.js';
import { pageKey, PAGES_MAP_NAME } from '../pages/page-map.js';
import { ADA, BOB, createFixtureStore, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { isPageRemovalBlocked } from './page-guard.js';
import { createHistory } from './undo-manager.js';

/**
 * Ada's and Bob's stores, holding the fixture board.
 *
 * @returns The stores.
 */
function pair(): [YjsDocumentStore, YjsDocumentStore] {
  const fixture = createFixtureStore();
  const ada = new YjsDocumentStore({ clientId: 310 });
  const bob = new YjsDocumentStore({ clientId: 311 });
  ada.applyUpdate(fixture.encodeState(), ADA);
  fixture.destroy();
  exchange(ada, bob);
  return [ada, bob];
}

const pageNames = (store: YjsDocumentStore): string[] =>
  [...store.read().pages.values()].map(({ name }) => name);

describe('the page guard', () => {
  it('keeps a page whose deletion was undone once a peer has renamed it', () => {
    const [ada, bob] = pair();
    const history = createHistory(ada, ADA_ID);
    const pageId = applyCommand(ada, addPageCommand, {}, ADA, testEnvironment(3)).result.pageId;
    applyCommand(ada, deletePageCommand, { pageId });
    expect(history.undo()).toBe(true);
    expect(pageNames(ada)).toEqual(['Page 1', 'Page 2']);
    exchange(ada, bob);
    applyCommand(bob, renamePageCommand, { pageId, name: 'Bob' }, BOB);
    exchange(ada, bob);
    history.undo();
    expect(pageNames(ada)).toEqual(['Page 1', 'Bob']);
    history.destroy();
    ada.destroy();
    bob.destroy();
  });

  it('keeps an added page a peer has since put an object on', () => {
    const [ada, bob] = pair();
    const history = createHistory(ada, ADA_ID);
    const pageId = applyCommand(ada, addPageCommand, {}, ADA, testEnvironment(3)).result.pageId;
    exchange(ada, bob);
    applyCommand(bob, moveObjectsToPageCommand, { ids: ['sticky-idea'], pageId }, BOB);
    exchange(ada, bob);
    history.undo();
    expect(ada.read().pages.has(pageId)).toBe(true);
    expect(ada.get('sticky-idea' as never)?.pageId).toBe(pageId);
    history.destroy();
    ada.destroy();
    bob.destroy();
  });

  it('keeps a duplicated page whose copy a peer has moved, used up whole', () => {
    const [ada, bob] = pair();
    const pageId = applyCommand(ada, addPageCommand, {}, ADA, testEnvironment(3)).result.pageId;
    applyCommand(ada, moveObjectsToPageCommand, { ids: ['sticky-idea'], pageId });
    const history = createHistory(ada, ADA_ID);
    const copy = applyCommand(ada, duplicatePageCommand, { pageId }, ADA, testEnvironment(4)).result
      .pageId;
    exchange(ada, bob);
    const copied = [...bob.read().objects.values()].find((object) => object.pageId === copy);
    if (copied === undefined) throw new Error('no copy');
    applyCommand(bob, moveObjectsCommand, { moves: [{ id: copied.id, by: { x: 5, y: 0 } }] }, BOB);
    exchange(ada, bob);
    history.undo();
    expect(ada.read().pages.has(copy)).toBe(true);
    expect(ada.get(copied.id)).toBeDefined();
    history.destroy();
    ada.destroy();
    bob.destroy();
  });

  it('lets a step recorded without its causal past remove a page, unless an object is kept', () => {
    const doc = new Y.Doc();
    const pages = doc.getMap<unknown>(PAGES_MAP_NAME);
    const objects = doc.getMap<unknown>('objects');
    const tokens = doc.getMap<unknown>('tokens');
    const styles = {
      text: doc.getMap<unknown>('textStyles'),
      effect: doc.getMap<unknown>('effectStyles'),
    };
    const manager = new Y.UndoManager(pages);
    pages.set(pageKey('page-new', 'identity'), { id: 'page-new' });
    const step = manager.undoStack[0];
    if (step === undefined) throw new Error('no step');
    const board = createFixtureStore();
    const verdicts = doc.transact((transaction) => [
      isPageRemovalBlocked(transaction, step, { pages, objects, tokens, styles }, board, false),
      isPageRemovalBlocked(transaction, step, { pages, objects, tokens, styles }, board, true),
    ]);
    expect(verdicts).toEqual([false, true]);
    expect(pages.has(pageKey('page-new', 'identity'))).toBe(true);
    board.destroy();
    manager.destroy();
    doc.destroy();
  });
});
