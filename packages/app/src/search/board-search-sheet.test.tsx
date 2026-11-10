// @vitest-environment jsdom
// The board search sheet and its button: results follow the query and the board, the
// keys move and go, All pages widens the search, and mod+f's requests open the sheet.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PAGE_ID,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import { DocumentBoardView } from '../engine/document-board-view.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import { createMemoryBoardView, memoryShape } from '../panels/__fixtures__/memory-board.js';
import type { ShellAction } from '../state/shell-action.js';

import { BoardSearchButton } from './board-search-button.js';
import { BoardSearchSheet } from './board-search-sheet.js';

const STYLE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * A shape labelled with some text.
 *
 * @param id - Its id.
 * @param z - Its z key.
 * @param text - Its label.
 * @returns The shape.
 */
function labelled(id: string, z: string, text: string): BoardObject {
  return {
    ...memoryShape(id, z),
    label: { text, runs: [{ length: text.length, style: STYLE }] },
  } as unknown as BoardObject;
}

/**
 * A board view over two labelled shapes and its store.
 *
 * @returns The store and the view.
 */
function boardView() {
  const store = createDemoDocument([
    {
      id: 'plan',
      type: 'frame',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      z: 'a3',
      locked: false,
      width: 400,
      height: 400,
      name: 'Planning',
      clip: false,
      background: [1, 1, 1, 1],
      createdBy: 'user:test',
      createdAt: 0,
      updatedAt: 0,
    } as unknown as BoardObject,
    { ...labelled('notes', 'a4', 'Release notes'), parentId: 'plan' } as unknown as BoardObject,
    labelled('bug', 'a0', 'Bug triage'),
    labelled('owner', 'a1', 'triage owner'),
    labelled('other', 'a2', 'Vacation'),
  ]);
  const view = new DocumentBoardView(store, { ids: () => [], select: () => undefined });
  return { store, view };
}

/**
 * Pages whose shown page can be set.
 *
 * @param current - The page shown.
 * @returns The pages.
 */
function pagesShowing(current: PageId): PageNavigation {
  return {
    pages: () => [] as Page[],
    current: () => current,
    objectCount: () => 0,
    show: () => undefined,
    step: () => undefined,
    run: () => undefined,
    subscribe: () => () => undefined,
  };
}

/**
 * Renders the sheet under a bar.
 *
 * @param pages - The pages.
 * @returns The handlers and the store.
 */
function renderSheet(pages: PageNavigation = pagesShowing(DEFAULT_PAGE_ID)) {
  const { store, view } = boardView();
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const onGoTo = (id: string) => ({ type: 'component', command: 'goToMain', id });
  const onClose = vi.fn();
  const bar = { current: document.body };
  render(
    <BoardSearchSheet
      barRef={bar}
      view={view}
      pages={pages}
      focusRequest={0}
      dispatch={dispatch}
      onClose={onClose}
    />,
  );
  return { store, dispatch, onGoTo, onClose };
}

const field = (): HTMLElement => screen.getByRole('searchbox', { name: 'Search board' });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('BoardSearchSheet', () => {
  it('shows nothing for a blank query and the count and rows for a match', () => {
    renderSheet();
    expect(document.activeElement).toBe(field());
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.change(field(), { target: { value: 'tri' } });
    expect(screen.getByRole('status').textContent).toBe('2');
    const text = screen.getByRole('group', { name: 'Text' });
    expect(within(text).getByText('Text · 2')).toBeTruthy();
    expect(
      within(text)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Bug triage', 'triage owner']);
    fireEvent.change(field(), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toBe('0');
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('moves with the arrows, goes with Enter or a click, and closes with Escape', () => {
    const { dispatch, onGoTo, onClose } = renderSheet();
    fireEvent.change(field(), { target: { value: 'tri' } });
    const options = screen.getAllByRole('option');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(dispatch).toHaveBeenLastCalledWith(onGoTo('owner'));
    fireEvent.click(screen.getAllByRole('option')[0] ?? document.body);
    expect(dispatch).toHaveBeenLastCalledWith(onGoTo('bug'));
    fireEvent.keyDown(field(), { key: 'a' });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names the section of a result and ignores Enter without a result or off the field', () => {
    const { dispatch } = renderSheet();
    fireEvent.change(field(), { target: { value: 'release' } });
    const row = screen.getByRole('option');
    expect(row.textContent).toBe('Release notesPlanning');
    expect(fireEvent.mouseDown(row)).toBe(false);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(row.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('switch', { name: 'All pages' }), { key: 'Enter' });
    fireEvent.change(field(), { target: { value: 'zzz' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('follows the board as it changes', async () => {
    const { store } = renderSheet();
    fireEvent.change(field(), { target: { value: 'holiday' } });
    expect(screen.getByRole('status').textContent).toBe('0');
    await act(async () => {
      store.transact(LOCAL_USER_ORIGIN, (transaction) => {
        transaction.patchObject(
          'other' as ObjectId,
          {
            label: { text: 'Holiday', runs: [{ length: 7, style: STYLE }] },
          } as never,
        );
      });
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('1');
  });

  it('searches the page shown unless All pages is on', () => {
    renderSheet(pagesShowing('page-2' as PageId));
    fireEvent.change(field(), { target: { value: 'tri' } });
    expect(screen.getByRole('status').textContent).toBe('0');
    const allPages = screen.getByRole('switch', { name: 'All pages' });
    fireEvent.mouseDown(allPages);
    fireEvent.click(allPages);
    expect(allPages.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('2');
  });

  it.each([
    { kind: 'before the engine mounts', view: undefined },
    { kind: 'in a view without the whole board', view: createMemoryBoardView([]) },
  ])('finds nothing $kind', ({ view }) => {
    const bar = { current: document.body };
    render(
      <BoardSearchSheet
        barRef={bar}
        view={view}
        pages={undefined}
        focusRequest={0}
        dispatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(field(), { target: { value: 'tri' } });
    expect(screen.getByRole('status').textContent).toBe('0');
  });
});

describe('BoardSearchButton', () => {
  /**
   * Renders the button.
   *
   * @param requests - The mod+f requests so far.
   * @param dispatch - The shell's dispatch.
   * @returns The render's rerender.
   */
  function renderButton(requests: number, dispatch: (action: ShellAction) => void) {
    const { view } = boardView();
    const bar = { current: document.body };
    const element = (count: number) => (
      <BoardSearchButton
        barRef={bar}
        search={{ view, pages: pagesShowing(DEFAULT_PAGE_ID) }}
        requests={count}
        dispatch={dispatch}
        className={undefined}
      />
    );
    const { rerender } = render(element(requests));
    return (count: number) => {
      rerender(element(count));
    };
  }

  it('toggles the sheet, goes through goToMain and gives focus back on Escape', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    renderButton(0, dispatch);
    const button = screen.getByRole('button', { name: 'Search board' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(field(), { target: { value: 'bug' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'component', command: 'goToMain', id: 'bug' });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on a mod+f request', () => {
    const rerender = renderButton(0, vi.fn());
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(1);
    expect(screen.getByRole('dialog', { name: 'Search board' })).toBeTruthy();
    expect(document.activeElement).toBe(field());
  });
});
