import { describe, expect, it } from 'vitest';

import type { ChangeSet, DocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, Page, PageId, PrincipalId } from '@canvas/schema';

import { PageIndex } from './page-index.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A page.
 *
 * @param id - Its id.
 * @param order - Its order key.
 * @returns The page.
 */
function page(id: string, order: string): Page {
  return { id: id as PageId, name: id, order, createdBy: null, createdAt: 0 } as unknown as Page;
}

/**
 * An object, only the fields the index reads.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or null for a root.
 * @param pageId - Its page, if any.
 * @returns The object.
 */
function object(id: string, parentId: string | null, pageId?: string): BoardObject {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    ...(pageId === undefined ? {} : { pageId: pageId as PageId }),
  } as unknown as BoardObject;
}

/**
 * A store holding objects and pages a test sets, read the way the index reads it.
 *
 * @param objects - The objects.
 * @returns The store and its object map.
 */
function fakeStore(objects: readonly BoardObject[]) {
  const byId = new Map(objects.map((item) => [item.id, item]));
  const pages = new Map([page('page-1', 'a0'), page('p2', 'a1')].map((item) => [item.id, item]));
  const store = {
    read: () => ({ objects: byId, issues: [], pages }),
    readPages: () => pages,
    get: (id: ObjectId) => byId.get(id),
    references: {
      childrenOf: (id: ObjectId | null) =>
        new Set([...byId.values()].filter((item) => item.parentId === id).map((item) => item.id)),
    },
  } as unknown as DocumentStore;
  return { store, byId };
}

/**
 * A change set of updates.
 *
 * @param updated - The ids updated.
 * @returns The change set.
 */
function updates(...updated: string[]): ChangeSet {
  return {
    origin: ORIGIN,
    isLocal: true,
    created: [],
    updated: updated as ObjectId[],
    deleted: [],
  };
}

describe('PageIndex', () => {
  it('shows a broken parent chain, a cycle, no page and a page not live on the first page', () => {
    const { store } = fakeStore([
      object('root', null, 'p2'),
      object('child', 'root'),
      object('orphan', 'missing'),
      object('loop-a', 'loop-b'),
      object('loop-b', 'loop-a'),
      object('pageless', null),
      object('stray', null, 'gone'),
    ]);
    const index = new PageIndex(store);
    expect(index.pageOf('root' as ObjectId)).toBe('p2');
    expect(index.pageOf('child' as ObjectId)).toBe('p2');
    for (const id of ['orphan', 'loop-a', 'loop-b', 'pageless', 'stray']) {
      expect(index.pageOf(id as ObjectId)).toBe('page-1');
    }
    expect(index.idsOn('p2' as PageId).sort()).toEqual(['child', 'root']);
  });

  it('drops an updated object the board no longer holds, and its subtree follows a move', () => {
    const { store, byId } = fakeStore([object('root', null, 'page-1'), object('child', 'root')]);
    const index = new PageIndex(store);
    byId.set('root' as ObjectId, object('root', null, 'p2'));
    expect(index.apply(updates('root'))).toEqual(
      new Map([
        ['root', { before: 'page-1', after: 'p2' }],
        ['child', { before: 'page-1', after: 'p2' }],
      ]),
    );
    byId.delete('child' as ObjectId);
    expect(index.apply(updates('child'))).toEqual(
      new Map([['child', { before: 'p2', after: undefined }]]),
    );
    expect(index.pageOf('child' as ObjectId)).toBeUndefined();
  });

  it('reports a parent and child created together as new, whichever comes first', () => {
    const { store, byId } = fakeStore([]);
    const index = new PageIndex(store);
    byId.set('a-parent' as ObjectId, object('a-parent', null, 'p2'));
    byId.set('b-child' as ObjectId, object('b-child', 'a-parent'));
    const created: ChangeSet = { ...updates(), created: ['a-parent', 'b-child'] as ObjectId[] };
    expect(index.apply(created)).toEqual(
      new Map([
        ['a-parent', { before: undefined, after: 'p2' }],
        ['b-child', { before: undefined, after: 'p2' }],
      ]),
    );
  });
});
