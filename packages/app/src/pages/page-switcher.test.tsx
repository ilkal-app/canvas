// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { floatingBoardMenuEntries, type FloatingMenuPages } from '../shell/floating-board-menu.js';

import { createPageView } from './create-page-view.js';
import { LATER_PAGE_CHANGE_NOTICE } from './page-delete-undo.js';
import { AddPageButton, PagesTrigger } from './page-switcher.js';
import { deletedPageNotice, PagesPanel } from './pages-panel.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

/**
 * A board with one rectangle on Page 1, and its pages.
 *
 * @returns The store and the pages.
 */
function board() {
  const store = new YjsDocumentStore();
  const environment = { clock: () => 1, createId: createSeededIdGenerator(11) };
  const { pages, release } = createPageView(store, ORIGIN, environment, {});
  store.transact(ORIGIN, (tx) => {
    tx.setObject(BOX);
  });
  return {
    store,
    pages,
    done: () => {
      release();
      store.destroy();
    },
  };
}

/** A rectangle at the root. */
const BOX = {
  id: 'box' as ObjectId,
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
} satisfies BoardObject;

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
});

describe('AddPageButton', () => {
  it('adds a page and shows it, on a board of one page or more', () => {
    const { pages, done } = board();
    render(<AddPageButton pages={pages} canEdit />);
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add.querySelector('svg')?.dataset.icon).toBe('plus');
    expect(add.textContent).toBe('Add page');
    act(() => {
      fireEvent.click(add);
    });
    expect(pages.pages().map((page) => page.name)).toEqual(['Page 1', 'Page 2']);
    expect(pages.current()).not.toBe('page-1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    });
    expect(pages.pages()).toHaveLength(3);
    done();
  });

  it('is the glyph alone on the compact bar, nothing for a viewer, and disabled before mount', () => {
    const { pages, done } = board();
    const { container, rerender } = render(
      <AddPageButton pages={pages} canEdit compactClassName="icon" />,
    );
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add.className).toBe('icon');
    expect(add.textContent).toBe('');
    rerender(<AddPageButton pages={pages} canEdit={false} />);
    expect(container.childElementCount).toBe(0);
    // Before an engine mounts it keeps its place, disabled, so the bar does not grow as it mounts.
    rerender(<AddPageButton pages={undefined} canEdit />);
    const waiting = screen.getByRole('button', { name: 'Add page' });
    expect(waiting).toHaveProperty('disabled', true);
    done();
  });
});

describe('PagesTrigger', () => {
  it('names the page shown and toggles the list', () => {
    const onToggle = vi.fn();
    render(<PagesTrigger name="Retro" isOpen={false} onToggle={onToggle} />);
    const trigger = screen.getByRole('button', { name: 'Pages, Retro' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.title).toBe('Retro (PageUp / PageDown)');
    expect(trigger.textContent).toBe('Retro▾');
    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('PagesPanel with onUndoDelete', () => {
  it('deletes at once, with no dialog, and its notice offers Undo', () => {
    const { pages, done } = board();
    act(() => {
      pages.run('addPage', {});
    });
    const notice = vi.fn();
    const undo = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={notice} onUndoDelete={undo} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'), { clientX: 4, clientY: 4 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pages.pages().map((page) => page.name)).toEqual(['Page 2']);
    expect(notice).toHaveBeenCalledWith('Deleted “Page 1” and its 1 object.', {
      label: 'Undo',
      run: expect.any(Function) as () => void,
    });
    const [, action] = notice.mock.calls[0] as [string, { readonly run: () => void }];
    action.run();
    expect(undo).toHaveBeenCalledTimes(1);
    done();
  });

  it('drops Undo once a page changed after the deletion, and says why', () => {
    const { pages, done } = board();
    act(() => {
      pages.run('addPage', {});
    });
    const notice = vi.fn();
    const undo = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={notice} onUndoDelete={undo} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 1'), { clientX: 4, clientY: 4 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    const [, action] = notice.mock.calls[0] as [string, { readonly run: () => void }];
    // A later Add page is the undo step on top now: Undo would take it back instead.
    act(() => {
      pages.run('addPage', {});
    });
    expect(notice).toHaveBeenLastCalledWith(LATER_PAGE_CHANGE_NOTICE);
    action.run();
    expect(undo).not.toHaveBeenCalled();
    act(() => {
      pages.run('addPage', {});
    });
    expect(notice).toHaveBeenCalledTimes(2);
    done();
  });

  it('drops Undo at an operated agent’s edit after the deletion, not at a collaborator’s change', () => {
    const { store, pages, done } = board();
    act(() => {
      pages.run('addPage', {});
    });
    const notice = vi.fn();
    const undo = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={notice} onUndoDelete={undo} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'), { clientX: 4, clientY: 4 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    const [, action] = notice.mock.calls[0] as [string, { readonly run: () => void }];
    // A collaborator's rename is not on this person's history: Undo stays.
    const other = { kind: 'user', principalId: 'user:bo' as PrincipalId } as const;
    act(() => {
      store.transact(other, (tx) => {
        tx.setObject({ ...BOX, id: 'theirs' as ObjectId });
      });
    });
    expect(notice).toHaveBeenCalledTimes(1);
    // An agent the person operates edits locally: their history records it, so Undo goes.
    const agent = {
      kind: 'agent',
      principalId: 'agent:helper' as PrincipalId,
      operatorId: ORIGIN.principalId,
    } as const;
    act(() => {
      store.transact(agent, (tx) => {
        tx.setObject({ ...BOX, id: 'agents' as ObjectId });
      });
    });
    expect(notice).toHaveBeenLastCalledWith(LATER_PAGE_CHANGE_NOTICE);
    action.run();
    expect(undo).not.toHaveBeenCalled();
    done();
  });

  it('drops Undo at the person’s own object edit after the deletion', () => {
    const { store, pages, done } = board();
    act(() => {
      pages.run('addPage', {});
    });
    const notice = vi.fn();
    const undo = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={notice} onUndoDelete={undo} />,
    );
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'), { clientX: 4, clientY: 4 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    const [, action] = notice.mock.calls[0] as [string, { readonly run: () => void }];
    // The person's own object edit is on their history: Undo would take it back first.
    act(() => {
      store.transact(ORIGIN, (tx) => {
        tx.setObject({ ...BOX, id: 'mine' as ObjectId });
      });
    });
    expect(notice).toHaveBeenLastCalledWith(LATER_PAGE_CHANGE_NOTICE);
    action.run();
    expect(undo).not.toHaveBeenCalled();
    done();
  });

  it('keeps Undo to one run, and lets it go once the notice has had its time', () => {
    vi.useFakeTimers();
    const { pages, done } = board();
    act(() => {
      pages.run('addPage', {});
      pages.run('addPage', {});
    });
    const notice = vi.fn();
    const undo = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={notice} onUndoDelete={undo} />,
    );
    const remove = (name: string): void => {
      act(() => {
        fireEvent.contextMenu(screen.getByText(name), { clientX: 4, clientY: 4 });
      });
      act(() => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
      });
    };
    remove('Page 1');
    const [, first] = notice.mock.calls[0] as [string, { readonly run: () => void }];
    first.run();
    first.run();
    expect(undo).toHaveBeenCalledTimes(1);
    remove('Page 2');
    const [, second] = notice.mock.calls[1] as [string, { readonly run: () => void }];
    act(() => {
      vi.runAllTimers();
    });
    second.run();
    expect(undo).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    done();
  });

  it('tells the list hearing onShow once a row shows a page', () => {
    const { pages, done } = board();
    act(() => {
      pages.run('addPage', {});
    });
    const onShow = vi.fn();
    render(
      <PagesPanel pages={pages} canEdit selectedIds={[]} onNotice={vi.fn()} onShow={onShow} />,
    );
    act(() => {
      fireEvent.click(screen.getByText('Page 2'));
    });
    expect(pages.current()).not.toBe('page-1');
    expect(onShow).toHaveBeenCalledTimes(1);
    // A press on the page shown may begin a rename: the list stays.
    act(() => {
      fireEvent.click(screen.getByText('Page 2'));
    });
    expect(onShow).toHaveBeenCalledTimes(1);
    done();
  });

  it('says what went: the page alone, or with its objects', () => {
    expect(deletedPageNotice('Retro', 0)).toBe('Deleted “Retro”.');
    expect(deletedPageNotice('Retro', 1)).toBe('Deleted “Retro” and its 1 object.');
    expect(deletedPageNotice('Retro', 24)).toBe('Deleted “Retro” and its 24 objects.');
  });
});

describe('the floating board menu’s page items', () => {
  /**
   * The menu's item ids, separators left out.
   *
   * @param pages - The page items.
   * @returns The ids.
   */
  const idsWith = (pages: FloatingMenuPages | undefined): string[] =>
    floatingBoardMenuEntries({
      host: undefined,
      onNavigateHome: vi.fn(),
      themePreference: 'system',
      onThemeChange: vi.fn(),
      onKeyboardShortcuts: vi.fn(),
      openUrl: vi.fn(),
      pages,
    }).flatMap((entry) => (entry.kind === 'separator' ? [] : [entry.id]));

  it('lists Pages, its meta the count, after All boards', () => {
    expect(idsWith({ onOpen: vi.fn(), count: 3 }).slice(0, 2)).toEqual(['all-boards', 'pages']);
    const entries = floatingBoardMenuEntries({
      host: undefined,
      onNavigateHome: undefined,
      themePreference: 'system',
      onThemeChange: vi.fn(),
      onKeyboardShortcuts: vi.fn(),
      openUrl: vi.fn(),
      pages: { onOpen: vi.fn(), count: 3 },
    });
    expect(entries[0]).toMatchObject({ kind: 'item', id: 'pages', label: 'Pages', meta: '3' });
  });

  it('leaves Pages out when it is not offered, and never lists Add page', () => {
    expect(idsWith({ onOpen: undefined, count: 1 })).not.toContain('pages');
    expect(idsWith(undefined)).not.toContain('pages');
    expect(idsWith({ onOpen: vi.fn(), count: 2 })).not.toContain('add-page');
  });
});
