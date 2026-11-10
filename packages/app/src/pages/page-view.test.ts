import { describe, expect, it } from 'vitest';

import {
  createHistory,
  findCommand,
  runCommand,
  YjsDocumentStore,
  type ChangeSet,
} from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { createPageView } from './create-page-view.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const environment = { clock: () => 1, createId: createSeededIdGenerator(5) };

/**
 * A rectangle at the root.
 *
 * @param id - Its id.
 * @param pageId - Its page, or none.
 * @returns The object.
 */
function rect(id: string, pageId?: string): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    ...(pageId === undefined ? {} : { pageId: pageId as PageId }),
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
 * A board with a rectangle on Page 1, a second page, and the page view over it.
 *
 * @returns The store, the view and the second page.
 * @throws {Error} When the page cannot be added.
 */
function setup() {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(rect('one'));
  });
  const command = findCommand('addPage');
  if (command === undefined) throw new Error('addPage is registered');
  const added = runCommand(store, ORIGIN, command, {}, environment);
  if (added.status !== 'applied') throw new Error('the page is added');
  const second = (added.result as { pageId: PageId }).pageId;
  const page = createPageView(store, ORIGIN, environment, {});
  return { store, second, ...page };
}

describe('the page view', () => {
  it('shows the page shown alone, and a switch is one change set of deletes and creates', () => {
    const { store, view, pages, second, release } = setup();
    store.transact(ORIGIN, (tx) => {
      tx.setObject(rect('two', second));
    });
    expect([...view.read().objects.keys()]).toEqual(['one']);
    expect(view.get('two' as ObjectId)).toBeUndefined();
    expect([...view.references.childrenOf(null)]).toEqual(['one']);
    const seen: ChangeSet[] = [];
    view.subscribe((changes) => seen.push(changes));
    pages.show(second);
    expect(seen).toEqual([expect.objectContaining({ created: ['two'], deleted: ['one'] })]);
    expect([...view.read().objects.keys()]).toEqual(['two']);
    release();
    store.destroy();
  });

  it('puts a new root object without a page on the page shown, and follows page moves', () => {
    const { store, view, pages, second, release } = setup();
    pages.show(second);
    const seen: ChangeSet[] = [];
    view.subscribe((changes) => seen.push(changes));
    view.transact(ORIGIN, (tx) => {
      tx.setObject(rect('new'));
    });
    expect(store.get('new' as ObjectId)?.pageId).toBe(second);
    expect(seen.at(-1)).toMatchObject({ created: ['new'] });
    pages.run('moveObjectsToPage', { ids: ['new'], pageId: 'page-1' });
    expect(seen.at(-1)).toMatchObject({ deleted: ['new'] });
    expect(view.get('new' as ObjectId)).toBeUndefined();
    release();
    store.destroy();
  });

  it('steps through the pages and goes to the first when the page shown is deleted', () => {
    const { store, pages, second, release } = setup();
    pages.step(1);
    expect(pages.current()).toBe(second);
    pages.step(1);
    expect(pages.current()).toBe(second);
    pages.show('nowhere' as PageId);
    expect(pages.current()).toBe(second);
    pages.run('deletePage', { pageId: second });
    expect(pages.current()).toBe('page-1');
    expect(pages.pages().map(({ id }) => id)).toEqual(['page-1']);
    release();
    store.destroy();
  });

  it('takes the person to the page of an undo on another page, and reports a refusal', () => {
    const { store, view, pages, second, release } = setup();
    const history = createHistory(store, ORIGIN.principalId);
    pages.show(second);
    view.transact(ORIGIN, (tx) => {
      tx.setObject(rect('there'));
    });
    history.stopCapturing();
    pages.show('page-1' as PageId);
    expect(history.undo()).toBe(true);
    expect(pages.current()).toBe(second);
    const refused: unknown[] = [];
    const { pages: other, release: releaseOther } = createPageView(store, ORIGIN, environment, {
      onRefused: (errors) => refused.push(...errors),
    });
    expect(other.run('deletePage', { pageId: 'nowhere' })).toBeUndefined();
    expect(refused).toEqual([expect.objectContaining({ code: 'missing-page' })]);
    releaseOther();
    history.destroy();
    release();
    store.destroy();
  });
});
