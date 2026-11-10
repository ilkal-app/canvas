import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId, PageId, PrincipalId } from '@canvas/schema';

import { createComponentBoard } from '../engine/__fixtures__/component-board.js';

import { PageBoardStore } from './page-board-store.js';
import { PageIndex } from './page-index.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A rectangle at the board root, on a page or none.
 *
 * @param id - Its id.
 * @param pageId - Its page, or undefined for none.
 * @returns The object.
 */
function rect(id: string, pageId?: PageId): BoardObject {
  return {
    ...{ id: id as ObjectId, type: 'shape', parentId: null, x: 0, y: 0, rotation: 0, z: 'a0' },
    ...{ locked: false, createdBy: ORIGIN.principalId, createdAt: 1, updatedAt: 1 },
    ...{ width: 10, height: 10, kind: 'rectangle', cornerRadius: 0, sides: 4, label: null },
    ...{ stroke: null, fill: [1, 0, 0, 1] },
    ...(pageId === undefined ? {} : { pageId }),
  };
}

describe('PageBoardStore', () => {
  it('reads the whole board and puts a new root given no page on the page shown', () => {
    const store = new YjsDocumentStore();
    store.transact(ORIGIN, (tx) => {
      tx.setPage(
        { id: 'page-2' as PageId, name: 'Two', order: 'a1' },
        {
          createdBy: ORIGIN.principalId,
          createdAt: 1,
        },
      );
      tx.setObject(rect('elsewhere', 'page-1' as PageId));
    });
    let page = 'page-2' as PageId;
    const board = new PageBoardStore(store, () => page);
    expect(board.defaultPageId()).toBe('page-2');
    expect(board.get('elsewhere' as ObjectId)).toBeDefined();
    expect(board.references.childrenOf(null).has('elsewhere' as ObjectId)).toBe(true);
    expect(board.read()).toBe(store.read());
    expect(board.readPages()).toBe(store.readPages());
    board.transact(ORIGIN, (tx) => {
      tx.setObject(rect('new'));
    });
    expect(store.get('new' as ObjectId)?.pageId).toBe('page-2');
    page = 'page-1' as PageId;
    board.transact(ORIGIN, (tx) => {
      tx.setObject(rect('later'));
    });
    expect(store.get('later' as ObjectId)?.pageId).toBe('page-1');
  });

  it('passes change sets, sync and repair to the whole board', () => {
    const store = new YjsDocumentStore();
    const board = new PageBoardStore(store, () => 'page-1' as PageId);
    const changes = vi.fn();
    const updates = vi.fn();
    const stopChanges = board.subscribe(changes);
    const stopUpdates = board.subscribeUpdates(updates);
    board.setRepairMode('write');
    board.transact(ORIGIN, (tx) => {
      tx.setObject(rect('one'));
    });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalled();
    expect(board.clientId).toBe(store.clientId);
    expect(board.hasPendingStructs).toBe(false);
    const other = new YjsDocumentStore();
    const otherBoard = new PageBoardStore(other, () => 'page-1' as PageId);
    otherBoard.applyUpdate(board.encodeState(otherBoard.encodeStateVector()), ORIGIN);
    expect(other.get('one' as ObjectId)).toBeDefined();
    expect(board.encodeSyncState().byteLength).toBeGreaterThan(0);
    board.destroy();
    expect(store.get('one' as ObjectId)).toBeDefined();
    stopChanges();
    stopUpdates();
  });
});

describe('the page view’s reverse indexes beside the whole board’s', () => {
  it('shows only the page’s referrers, where the whole board shows all', () => {
    const { store, firstPageId, instancePageId } = createComponentBoard({
      isInstanceOnSecondPage: true,
    });
    const view = new PageScopedStore(store, new PageIndex(store), firstPageId);
    const board = new PageBoardStore(store, () => view.page);
    const card = 'card' as ObjectId;
    expect([...view.references.instancesOf(card)]).toEqual([]);
    expect([...board.references.instancesOf(card)]).toEqual(['inst']);
    expect(view.references.connectorsAttachedTo(card).size).toBe(0);
    expect(view.references.commentsAnchoredTo(card).size).toBe(0);
    view.show(instancePageId);
    expect([...view.references.instancesOf(card)]).toEqual(['inst']);
    expect(view.clientId).toBe(store.clientId);
    view.destroy();
  });
});
