// The components panel's list (ruling 3): every live main on the board, by page then
// paint order, with its page's name.
import { describe, expect, it, vi } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId, PageId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../../engine/__fixtures__/component-board.js';
import { mountComponentBoard } from '../../engine/__fixtures__/mounted-component-board.js';
import { LOCAL_USER_ORIGIN } from '../../engine/demo-document.js';

import { componentListOf, componentListWatchOf, isComponentListChange } from './component-list.js';
import { ComponentListModel } from './use-component-list.js';

describe('componentListOf', () => {
  it('lists live mains by page, then paint order, with their page', () => {
    const { store, firstPageId } = createComponentBoard({ isInstanceOnSecondPage: true });
    const { pageId } = mustRun(store, 'addPage', { name: 'Library' }) as { pageId: PageId };
    createRectangle(store, 'chip-dot', null, { x: 0, y: 0, width: 10, height: 10 });
    mustRun(store, 'moveObjectsToPage', { ids: ['chip-dot'], pageId });
    mustRun(store, 'createComponent', { ids: ['chip-dot'], name: 'Chip', componentId: 'chip' });
    const pages = store.readPages();
    expect(componentListOf(store)).toEqual([
      { id: 'badge', name: 'Badge', pageId: firstPageId, pageName: pages.get(firstPageId)?.name },
      { id: 'card', name: 'Card', pageId: firstPageId, pageName: pages.get(firstPageId)?.name },
      { id: 'chip', name: 'Chip', pageId, pageName: 'Library' },
    ]);
  });

  it('captions a variant set with its axes, and a main with none or an empty list without', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'setVariantAxes', {
      componentId: 'card',
      axes: [
        { name: 'state', values: ['rest', 'hover'] },
        { name: 'size', values: ['s'] },
      ],
    });
    mustRun(store, 'setVariantAxes', { componentId: 'badge', axes: [] });
    const items = componentListOf(store);
    expect(items.find(({ id }) => id === 'card')?.axes).toBe('state: rest, hover; size: s');
    expect(items.find(({ id }) => id === 'badge')).not.toHaveProperty('axes');
  });

  it('leaves out retired mains, and names an unnamed main', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'deleteObjects', { ids: ['card'] });
    mustRun(store, 'renameFrame', { id: 'badge', name: '' });
    expect(componentListOf(store).map(({ id, name }) => [id, name])).toEqual([
      ['badge', 'Component'],
    ]);
  });

  it('lists a main inside a group', () => {
    const { store } = createComponentBoard();
    createRectangle(store, 'beside', null, { x: 0, y: 900, width: 10, height: 10 });
    mustRun(store, 'group', { ids: ['badge', 'beside'], groupId: 'holder' });
    expect(store.get('badge' as ObjectId)?.parentId).toBe('holder');
    expect(componentListOf(store).map(({ id }) => id)).toContain('badge');
  });
});

describe('isComponentListChange', () => {
  const changes = (fields: Partial<ChangeSet>): ChangeSet => ({
    origin: LOCAL_USER_ORIGIN,
    isLocal: true,
    created: [],
    updated: [],
    deleted: [],
    ...fields,
  });

  it('tells a change to a main, or to the pages, from any other', () => {
    const { store } = createComponentBoard();
    const listed = new Set(['card'] as ObjectId[]);
    const is = (fields: Partial<ChangeSet>) =>
      isComponentListChange(store, changes(fields), listed);
    expect(is({ updated: ['card'] as ObjectId[] })).toBe(true);
    expect(is({ deleted: ['card'] as ObjectId[] })).toBe(true);
    expect(is({ created: ['badge'] as ObjectId[] })).toBe(true);
    expect(is({ pages: ['page-1' as PageId] })).toBe(true);
    expect(is({ updated: ['title'] as ObjectId[] })).toBe(false);
  });

  it('follows the listed mains and their ancestors', () => {
    const { store } = createComponentBoard();
    createRectangle(store, 'beside', null, { x: 0, y: 900, width: 10, height: 10 });
    mustRun(store, 'group', { ids: ['badge', 'beside'], groupId: 'holder' });
    const watched = componentListWatchOf(store, componentListOf(store));
    expect([...watched].sort()).toEqual(['badge', 'card', 'holder']);
  });
});

describe('ComponentListModel', () => {
  it('works the list out again only after a change that may change it', () => {
    const { document, store } = mountComponentBoard(true);
    const model = new ComponentListModel(document.panels.board);
    const changed = vi.fn();
    const stop = model.subscribe(changed);
    const first = model.items();
    expect(first.map(({ id }) => id)).toEqual(['badge', 'card']);
    createRectangle(store, 'loose', null, { x: 0, y: 900, width: 10, height: 10 });
    expect(changed).not.toHaveBeenCalled();
    expect(model.items()).toBe(first);
    mustRun(store, 'renameFrame', { id: 'card', name: 'Profile' });
    expect(changed).toHaveBeenCalledOnce();
    expect(model.items().map(({ name }) => name)).toEqual(['Badge', 'Profile']);
    stop();
  });
});
