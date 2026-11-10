// @vitest-environment jsdom
// The floating board bar's pages: Add page last on a one-page board, the page dropdown
// from two pages on, and its list: focus, the arrow keys, Enter, Escape, a press outside, the Add
// page row, a deletion's Undo through the shell's history, and the phone's board menu.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import type { NoticeAction } from '../hooks/use-notice.js';
import { createPageView } from '../pages/create-page-view.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { FloatingBoardBar } from './floating-board-bar.js';
import { MOBILE_SITE_QUERY } from './mobile-site.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

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

/**
 * A board of `count` pages with one rectangle on Page 1, and its pages.
 *
 * @param count - How many pages.
 * @returns The pages and a cleanup.
 */
function board(count: number) {
  const store = new YjsDocumentStore();
  const environment = { clock: () => 1, createId: createSeededIdGenerator(13) };
  const { pages, release } = createPageView(store, ORIGIN, environment, {});
  store.transact(ORIGIN, (tx) => {
    tx.setObject(BOX);
  });
  for (let page = 1; page < count; page += 1) pages.run('addPage', {});
  pages.show(pages.pages()[0]?.id ?? pages.current());
  return {
    pages,
    done: () => {
      release();
      store.destroy();
    },
  };
}

/**
 * Renders the bar over the pages.
 *
 * @param pages - The pages.
 * @param options - The role, and the notice and dispatch spies.
 * @param options.canEdit - Whether the person may edit; true if absent.
 * @returns The spies.
 */
function renderBar(pages: PageNavigation, options: { readonly canEdit?: boolean } = {}) {
  const dispatch = vi.fn();
  const onNotice = vi.fn<(message: string, action?: NoticeAction) => void>();
  render(
    <FloatingBoardBar
      content={undefined}
      fallbackTitle="Board"
      actions={[]}
      state={INITIAL_SHELL_STATE}
      dispatch={dispatch}
      themePreference="system"
      onThemeChange={vi.fn()}
      board={undefined}
      search={{ view: undefined, pages, engine: undefined }}
      pageList={{ canEdit: options.canEdit ?? true, selectedIds: [], onNotice }}
    />,
  );
  return { dispatch, onNotice };
}

/**
 * Stubs the phone's media query (below 768 px) for the test.
 */
function asPhone(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === MOBILE_SITE_QUERY,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('the floating board bar’s pages', () => {
  it('ends with Add page on a one-page board, which adds Page 2; a viewer sees none', () => {
    const { pages, done } = board(1);
    renderBar(pages);
    const bar = screen.getByRole('group', { name: 'Board' });
    const controls = [...bar.querySelectorAll(':scope > button')];
    expect(controls.at(-1)?.textContent).toBe('Add page');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    });
    expect(pages.pages()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Pages, Page 2' })).toBeDefined();
    cleanup();
    renderBar(pages, { canEdit: false });
    expect(screen.queryByRole('button', { name: 'Add page' })).toBeNull();
    done();
  });

  it('drops the list down from the dropdown: focus, arrows, Enter, Escape, a press outside', () => {
    const observed: Element[] = [];
    let resized: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {
          observed.length = 0;
        }
      },
    );
    const { pages, done } = board(2);
    renderBar(pages);
    const dropdown = screen.getByRole('button', { name: 'Pages, Page 1' });
    act(() => {
      fireEvent.click(dropdown);
    });
    const sheet = screen.getByRole('dialog', { name: 'Pages' });
    expect(sheet.querySelector('h2')).toBeNull();
    // The list follows the bar's size (a rename widens the dropdown).
    expect(observed).toEqual([screen.getByRole('group', { name: 'Board' })]);
    const place = sheet.getAttribute('style');
    act(() => {
      resized?.();
    });
    expect(sheet.getAttribute('style')).toBe(place);
    const rows = screen.getAllByRole('listitem');
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(document.activeElement).toBe(rows[0]);
    // From the sheet itself, down goes to the first row.
    sheet.tabIndex = -1;
    sheet.focus();
    fireEvent.keyDown(sheet, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(sheet, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(sheet, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(sheet, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(sheet, { key: 'ArrowUp' });
    fireEvent.keyDown(sheet, { key: 'ArrowUp' });
    fireEvent.keyDown(sheet, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    // Escape in the list closes it and gives focus back to the dropdown.
    act(() => {
      fireEvent.keyDown(sheet, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(dropdown);
    // Escape with focus outside the list, on the dropdown, closes it too.
    act(() => {
      fireEvent.click(dropdown);
    });
    act(() => {
      dropdown.focus();
      fireEvent.keyDown(dropdown, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // A press on the dropdown is its toggle's; a press elsewhere closes the list.
    act(() => {
      fireEvent.click(dropdown);
    });
    act(() => {
      fireEvent.pointerDown(dropdown);
      fireEvent.pointerDown(screen.getAllByRole('listitem')[0] ?? document.body);
    });
    expect(screen.getByRole('dialog', { name: 'Pages' })).toBeDefined();
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Enter on another row shows its page and closes the list.
    act(() => {
      fireEvent.click(dropdown);
    });
    const second = screen.getAllByRole('listitem')[1];
    if (second === undefined) throw new Error('no second row');
    act(() => {
      fireEvent.keyDown(second, { key: 'Enter' });
    });
    expect(pages.current()).not.toBe('page-1');
    expect(screen.queryByRole('dialog')).toBeNull();
    done();
  });

  it('adds a page from the list’s last row, closing the list', () => {
    const { pages, done } = board(2);
    renderBar(pages);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Pages, Page 1' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add page' }));
    });
    expect(pages.pages()).toHaveLength(3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pages, Page 3' })).toBeDefined();
    done();
  });

  it('deletes from the list with a notice whose Undo is the shell’s history undo', () => {
    const { pages, done } = board(2);
    const { dispatch, onNotice } = renderBar(pages);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Pages, Page 1' }));
    });
    act(() => {
      fireEvent.contextMenu(screen.getByText('Page 2'), { clientX: 4, clientY: 4 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    });
    const [message, action] = onNotice.mock.calls[0] ?? [];
    expect(message).toBe('Deleted “Page 2”.');
    // One page left: the list closes, and Add page is back at the bar's end.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add page' })).toBeDefined();
    action?.run();
    expect(dispatch).toHaveBeenCalledWith({ type: 'history', command: 'undo' });
    done();
  });

  it('on a phone: the + glyph at the end, then the dropdown, and Pages in the board menu', () => {
    asPhone();
    const { pages, done } = board(1);
    renderBar(pages);
    const add = screen.getByRole('button', { name: 'Add page' });
    expect(add.textContent).toBe('');
    act(() => {
      fireEvent.click(add);
    });
    expect(screen.getByRole('button', { name: 'Pages, Page 2' })).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^Pages/ }));
    });
    expect(screen.getByRole('dialog', { name: 'Pages' }).dataset.compact).toBe('');
    done();
  });
});
