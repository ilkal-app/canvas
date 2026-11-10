import { describe, expect, it, vi } from 'vitest';

import { findCommand, YjsDocumentStore } from '@canvas/document';
import { createSeededIdGenerator, type Page, type PageId, type PrincipalId } from '@canvas/schema';

import { PageIndex } from './page-index.js';
import { collaboratorPageName, PageNavigator } from './page-navigator.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A page.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @returns The page.
 */
function page(id: string, name: string): Page {
  return { id: id as PageId, name, order: 'a0', createdBy: null, createdAt: 0 } as unknown as Page;
}

describe('collaboratorPageName', () => {
  it("names a collaborator's page only on a board of several pages", () => {
    const one = { pages: () => [page('page-1', 'Page 1')] };
    const two = { pages: () => [page('page-1', 'Page 1'), page('p2', 'Wireframes')] };
    expect(collaboratorPageName(undefined, 'page-1')).toBeUndefined();
    expect(collaboratorPageName(one, 'page-1')).toBeUndefined();
    expect(collaboratorPageName(two, 'p2')).toBe('Wireframes');
    expect(collaboratorPageName(two, 'gone')).toBeUndefined();
  });
});

describe('PageNavigator', () => {
  it('tells beforeSwitch the pages of a switch, and runs no command it does not know', () => {
    const store = new YjsDocumentStore();
    const view = new PageScopedStore(store, new PageIndex(store), 'page-1' as PageId);
    const beforeSwitch = vi.fn();
    const environment = { clock: () => 1, createId: createSeededIdGenerator(3) };
    const navigator = new PageNavigator({
      store,
      view,
      origin: ORIGIN,
      environment,
      findCommand: (name) => (name === 'addPage' ? findCommand(name) : undefined),
      beforeSwitch,
    });
    const added = navigator.run('addPage', {}) as { pageId: PageId };
    navigator.show(added.pageId);
    expect(beforeSwitch).toHaveBeenCalledWith('page-1', added.pageId);
    expect(navigator.run('deletePage', { pageId: added.pageId })).toBeUndefined();
    expect(store.readPages().has(added.pageId)).toBe(true);
    navigator.destroy();
    view.destroy();
    store.destroy();
  });
});
