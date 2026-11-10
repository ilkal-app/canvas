// @vitest-environment jsdom
// Comment results in the board search sheet: found from the client's threads, on
// the page searched, resolved ones behind the switch; going to one shows its pin's page, frames
// the pin, opens the thread and hands focus back to the field.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_ID, type Page, type PageId } from '@canvas/schema';

import type { Thread } from '../comments/comment-api.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { commentPlacement, placeThreadPin } from '../comments/comment-placement.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from '../engine/demo-document.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import { memoryShape } from '../panels/__fixtures__/memory-board.js';
import type { ShellAction } from '../state/shell-action.js';

import { BoardSearchSheet } from './board-search-sheet.js';

/**
 * A thread of one message.
 *
 * @param id - Its id.
 * @param pinId - Its pin.
 * @param text - The message.
 * @param isResolved - Whether it is resolved.
 * @returns The thread.
 */
function thread(id: string, pinId: string, text: string, isResolved = false): Thread {
  return {
    id,
    pinId,
    isResolved,
    messages: [
      {
        id: `${id}-1`,
        authorId: 'ana',
        authorName: 'Ana',
        text,
        mentions: [],
        createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
    ],
  };
}

/**
 * A board with a 10 px shape at the origin and two pins: one on the shape, one in empty space.
 *
 * @returns The store and the pins' ids.
 */
function boardWithPins() {
  const store = createDemoDocument([memoryShape('box', 'a0')]);
  const connection = { store, origin: LOCAL_USER_ORIGIN };
  const onShape = commentPlacement(store.read(), { x: 5, y: 5 }, 1);
  const inSpace = commentPlacement(store.read(), { x: 900, y: 900 }, 1);
  placeThreadPin(connection, onShape, 'open');
  placeThreadPin(connection, inSpace, 'done');
  return { store, onShape: onShape.id, inSpace: inSpace.id };
}

/**
 * Pages showing one page, whose switches are recorded; a switch finishes at once, or when the
 * test says so.
 *
 * @param start - The page shown first.
 * @param isDeferred - Whether a switch waits for `finish`.
 * @returns The pages, the recorded switches and the way to finish a waiting one.
 */
function pagesShowing(
  start: PageId,
  isDeferred = false,
): {
  readonly pages: PageNavigation;
  readonly show: ReturnType<typeof vi.fn>;
  readonly finish: () => void;
} {
  let current = start;
  let finish = (): void => undefined;
  const shown = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const show = vi.fn();
  const pages: PageNavigation = {
    pages: () => [] as Page[],
    current: () => current,
    objectCount: () => 0,
    show: (pageId) => {
      show(pageId);
      current = pageId;
    },
    step: () => undefined,
    run: () => undefined,
    subscribe: () => () => undefined,
    whenShown: () => (isDeferred ? shown : Promise.resolve()),
  };
  return { pages, show, finish };
}

/**
 * Renders the sheet over a board with comments.
 *
 * @param pages - The pages.
 * @returns The handlers and a way to change the open thread.
 */
function renderSheet(pages: PageNavigation = pagesShowing(DEFAULT_PAGE_ID).pages) {
  const { store, onShape, inSpace } = boardWithPins();
  const threads = [
    thread('open', onShape, 'try triage at 10?'),
    thread('done', inSpace, 'triage moved', true),
    thread('lost', 'no-such-pin', 'triage elsewhere'),
  ];
  const select = vi.fn<(id: string | undefined) => void>();
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const data = (selectedId: string | undefined) =>
    ({ connection: { store }, threads, selectedId, select }) as unknown as CommentData;
  const sheet = (selectedId: string | undefined) => (
    <commentDataContext.Provider value={data(selectedId)}>
      <BoardSearchSheet
        barRef={{ current: document.body }}
        view={undefined}
        pages={pages}
        focusRequest={0}
        dispatch={dispatch}
        onClose={vi.fn()}
      />
    </commentDataContext.Provider>
  );
  const { rerender } = render(sheet(undefined));
  return {
    select,
    dispatch,
    open: (id: string) => {
      rerender(sheet(id));
    },
  };
}

const field = (): HTMLElement => screen.getByRole('searchbox', { name: 'Search board' });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('board search: comments', () => {
  it('finds open threads on the page shown, with the author and the age', () => {
    renderSheet();
    fireEvent.change(field(), { target: { value: 'triage' } });
    const group = screen.getByRole('group', { name: 'Comments' });
    expect(within(group).getByText('Comments · 1')).toBeTruthy();
    expect(within(group).getByRole('option').textContent).toBe('Ana: try triage at 10?2 h');
    expect(screen.getByRole('status').textContent).toBe('1');
  });

  it('adds resolved threads behind the switch, and focus stays in the field', () => {
    renderSheet();
    fireEvent.change(field(), { target: { value: 'triage' } });
    const resolved = screen.getByRole('switch', { name: 'Resolved' });
    fireEvent.click(resolved);
    expect(resolved.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('2');
    expect(document.activeElement).toBe(field());
  });

  it('frames the pin, opens the thread and hands focus back to the field', async () => {
    const { select, dispatch, open } = renderSheet();
    fireEvent.change(field(), { target: { value: 'triage' } });
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' });
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'frame',
      bounds: { minX: -315, minY: -195, maxX: 325, maxY: 205 },
    });
    expect(select).toHaveBeenCalledWith('open');
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      open('open');
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(field());
  });

  it('shows the pin’s page first when it is another, with All pages on', async () => {
    const { pages, show } = pagesShowing('page-2' as PageId);
    const { select } = renderSheet(pages);
    fireEvent.change(field(), { target: { value: 'triage' } });
    expect(screen.queryByRole('group', { name: 'Comments' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'All pages' }));
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(show).toHaveBeenCalledWith(DEFAULT_PAGE_ID);
    expect(select).toHaveBeenCalledWith('open');
  });

  it('goes nowhere for a thread whose pin is gone, and then leaves focus alone', async () => {
    const { select, dispatch, open } = renderSheet();
    fireEvent.click(screen.getByRole('switch', { name: 'All pages' }));
    fireEvent.change(field(), { target: { value: 'elsewhere' } });
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' });
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    await act(async () => {
      open('lost');
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('gives up when a newer page switch overtakes the comment’s', async () => {
    const { pages, show, finish } = pagesShowing('page-2' as PageId, true);
    const { select, dispatch } = renderSheet(pages);
    fireEvent.click(screen.getByRole('switch', { name: 'All pages' }));
    fireEvent.change(field(), { target: { value: 'triage' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(show).toHaveBeenCalledWith(DEFAULT_PAGE_ID);
    pages.show('page-3' as PageId);
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('hands focus back at once when the thread was already open', async () => {
    const { select, open } = renderSheet();
    open('open');
    fireEvent.change(field(), { target: { value: 'triage' } });
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' });
      await Promise.resolve();
    });
    expect(select).toHaveBeenCalledWith('open');
    expect(document.activeElement).toBe(field());
  });
});
