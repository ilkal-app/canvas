// Undo and redo take the person to the page their change lands on, against the real store, history,
// page commands and page view.
import { describe, expect, it } from 'vitest';

import { createHistory, findCommand, runCommand, YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { createPageView } from './create-page-view.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const environment = { clock: () => 1, createId: createSeededIdGenerator(7) };

/**
 * A rectangle at the root of Page 1.
 *
 * @param id - Its id.
 * @returns The object.
 */
function rect(id: string): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

/**
 * A board of two pages with a rectangle on Page 1, its page view, and the person's history.
 *
 * @returns The board, its pages, the second page and the history.
 * @throws {Error} When the second page cannot be added.
 */
function setup() {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(rect('box'));
  });
  const command = findCommand('addPage');
  if (command === undefined) throw new Error('addPage is registered');
  const added = runCommand(store, ORIGIN, command, {}, environment);
  if (added.status !== 'applied') throw new Error('the page is added');
  const second = (added.result as { pageId: PageId }).pageId;
  const page = createPageView(store, ORIGIN, environment, {});
  const history = createHistory(store, ORIGIN.principalId);
  history.stopCapturing();
  return { store, second, history, ...page };
}

describe('undo and redo of a move to another page', () => {
  it('undo shows the page the object goes back to, from the page it was moved to', () => {
    const { store, second, history, pages, release } = setup();
    pages.run('moveObjectsToPage', { ids: ['box'], pageId: second });
    history.stopCapturing();
    expect(store.get('box' as ObjectId)?.pageId).toBe(second);
    // Following the move notice to Page 2, then undoing: the box goes back to Page 1.
    pages.show(second);
    expect(history.undo()).toBe(true);
    expect(store.get('box' as ObjectId)?.pageId).toBe('page-1');
    expect(pages.current()).toBe('page-1');
    history.destroy();
    release();
    store.destroy();
  });

  it('redo shows the page the object moves to again, from the page it came back to', () => {
    const { store, second, history, pages, release } = setup();
    pages.run('moveObjectsToPage', { ids: ['box'], pageId: second });
    history.stopCapturing();
    expect(history.undo()).toBe(true);
    expect(pages.current()).toBe('page-1');
    expect(history.redo()).toBe(true);
    expect(store.get('box' as ObjectId)?.pageId).toBe(second);
    expect(pages.current()).toBe(second);
    history.destroy();
    release();
    store.destroy();
  });

  it('stays on the page shown when the change lands there', () => {
    const { store, second, history, pages, release } = setup();
    pages.run('moveObjectsToPage', { ids: ['box'], pageId: second });
    history.stopCapturing();
    expect(pages.current()).toBe('page-1');
    expect(history.undo()).toBe(true);
    expect(pages.current()).toBe('page-1');
    history.destroy();
    release();
    store.destroy();
  });

  it('goes to the page a deletion was on, the deletion leaving nothing to land', () => {
    const { store, second, history, pages, release } = setup();
    store.transact(ORIGIN, (tx) => {
      tx.setObject({ ...rect('there'), pageId: second });
    });
    history.stopCapturing();
    pages.show('page-1' as PageId);
    expect(history.undo()).toBe(true);
    expect(store.get('there' as ObjectId)).toBeUndefined();
    expect(pages.current()).toBe(second);
    history.destroy();
    release();
    store.destroy();
  });
});
