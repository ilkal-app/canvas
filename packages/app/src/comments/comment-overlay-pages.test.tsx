// @vitest-environment jsdom
// Comment pins by page: the overlay draws only the page shown's pins and places a new
// pin on that page. The threads panel shows a thread's page before opening it, and a switch closes
// a card whose pin is not on the new page.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { addPageCommand, runCommand } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId, type PageId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { placeThreadPin } from './comment-placement.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Comment data over a fake board with one thread, "Hello", pinned at `pin`.
 *
 * @returns The data.
 */
function data() {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [
      {
        id: 'open',
        pinId: 'pin',
        isResolved: false,
        messages: [
          {
            id: 'm',
            authorId: 'other',
            authorName: 'Other',
            text: 'Hello',
            mentions: [],
            createdAt: new Date(0).toISOString(),
          },
        ],
      },
    ],
    selectedId: undefined,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: false,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  } satisfies CommentData;
}

it('draws only the page shown’s pins and places a new one on that page', () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const state = data();
  const { store, origin } = state.connection;
  const environment = { clock: () => 1, createId: () => 'whiteboard' as ObjectId };
  runCommand(store, origin, addPageCommand, { name: 'Whiteboard' }, environment);
  const whiteboard = [...store.readPages().keys()].find((id) => id !== DEFAULT_PAGE_ID);
  if (whiteboard === undefined) throw new Error('no second page');
  // 'open' is pinned on the first page; a second thread on the page shown.
  placeThreadPin(
    state.connection,
    {
      id: 'pin' as ObjectId,
      point: { x: 10, y: 20 },
      anchor: { kind: 'point' },
      pageId: DEFAULT_PAGE_ID,
    },
    'open',
  );
  placeThreadPin(
    state.connection,
    {
      id: 'shown-pin' as ObjectId,
      point: { x: 30, y: 40 },
      anchor: { kind: 'point' },
      pageId: whiteboard,
    },
    'shown',
  );
  const threads = [
    ...state.threads,
    {
      id: 'shown',
      pinId: 'shown-pin',
      isResolved: false,
      messages: [
        {
          id: 'n',
          authorId: 'other',
          authorName: 'Other',
          text: 'On the whiteboard',
          mentions: [],
          createdAt: new Date(0).toISOString(),
        },
      ],
    },
  ];
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
    pages: { current: () => whiteboard, subscribe: () => () => undefined },
  } as unknown as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: true,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  const view = render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={{ ...state, threads, error: '' }}>
        <div>
          <canvas />
          <CommentOverlay engine={engine} />
        </div>
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.getByRole('button', { name: 'Comment thread: On the whiteboard' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Comment thread: Hello' })).toBeNull();
  const canvas = view.container.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');
  fireEvent(
    canvas,
    new MouseEvent('pointerdown', { button: 0, clientX: 200, clientY: 150, bubbles: true }),
  );
  expect(state.place).toHaveBeenCalledWith(expect.objectContaining({ pageId: whiteboard }));
  store.destroy();
});

/**
 * Two pages, "Hello" pinned on the first (and "Kept by the service", whose pin the comments service
 * keeps) and "On the whiteboard" on the second, shown, with the threads panel open, pages that
 * switch at once (or on `flush`), and comment data that holds its selection.
 *
 * @param options - How the pages switch.
 * @param options.isDeferred - Whether a switch waits for `flush`, as for a busy store.
 * @returns The rendered overlay, the call log, the pages and `flush`.
 * @throws {Error} When the board has no second page.
 */
function twoPages({ isDeferred = false } = {}) {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  // Reduced motion: a card opens and closes at once.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const state = data();
  const { store, origin } = state.connection;
  const environment = { clock: () => 1, createId: () => 'whiteboard' as ObjectId };
  runCommand(store, origin, addPageCommand, { name: 'Whiteboard' }, environment);
  const whiteboard = [...store.readPages().keys()].find((id) => id !== DEFAULT_PAGE_ID);
  if (whiteboard === undefined) throw new Error('no second page');
  placeThreadPin(
    state.connection,
    {
      id: 'pin' as ObjectId,
      point: { x: 10, y: 20 },
      anchor: { kind: 'point' },
      pageId: DEFAULT_PAGE_ID,
    },
    'open',
  );
  placeThreadPin(
    state.connection,
    {
      id: 'shown-pin' as ObjectId,
      point: { x: 30, y: 40 },
      anchor: { kind: 'point' },
      pageId: whiteboard,
    },
    'shown',
  );
  const threads = [
    ...state.threads,
    {
      id: 'shown',
      pinId: 'shown-pin',
      isResolved: false,
      messages: [
        {
          id: 'n',
          authorId: 'other',
          authorName: 'Other',
          text: 'On the whiteboard',
          mentions: [],
          createdAt: new Date(0).toISOString(),
        },
      ],
    },
    // A pin the comments service keeps, with no document object.
    {
      id: 'service',
      pinId: 'service-pin',
      isResolved: false,
      pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' as const }, point: { x: 50, y: 60 } },
      messages: [
        {
          id: 's',
          authorId: 'other',
          authorName: 'Other',
          text: 'Kept by the service',
          mentions: [],
          createdAt: new Date(0).toISOString(),
        },
      ],
    },
  ];
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  let page: PageId = whiteboard;
  let wanted: PageId | undefined;
  const switchNow = (id: PageId) => {
    page = id;
    for (const listener of listeners) listener();
  };
  const pages = {
    current: () => page,
    show: vi.fn((id: PageId) => {
      calls.push(`show ${id}`);
      if (isDeferred) wanted = id;
      else switchNow(id);
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
    pages,
  } as unknown as MountedEngine;
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: true,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  const selection = { id: undefined as string | undefined };
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | undefined>();
    selection.id = selectedId;
    const value: CommentData = {
      ...state,
      threads,
      selectedId,
      select: (id: string) => {
        calls.push(`select ${id}`);
        setSelectedId(id);
      },
      close: () => {
        calls.push('close');
        setSelectedId(undefined);
      },
    };
    return (
      <commentContext.Provider value={mode}>
        <commentDataContext.Provider value={value}>
          <div>
            <canvas />
            <CommentOverlay engine={engine} />
          </div>
        </commentDataContext.Provider>
      </commentContext.Provider>
    );
  }
  render(<Harness />);
  /** Lets a deferred switch happen, as `PageNavigator.show` does once the store is idle. */
  const flush = () => {
    if (wanted !== undefined) switchNow(wanted);
    wanted = undefined;
  };
  return { calls, flush, pages, selection, store, whiteboard };
}

/**
 * The panel's button for a thread.
 *
 * @param text - The thread's first message.
 * @returns The button.
 */
function panelItem(text: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Open threads' });
  return within(list).getByRole('button', { name: text });
}

it('a thread on another page shows that page, then opens beside its pin', () => {
  const { calls, selection, store } = twoPages();
  expect(screen.queryByRole('button', { name: 'Comment thread: Hello' })).toBeNull();
  fireEvent.click(panelItem('Hello'));
  expect(calls).toEqual([`show ${DEFAULT_PAGE_ID}`, 'select open']);
  // The switch did not close the thread chosen with it, and its pin is drawn beside its card.
  expect(selection.id).toBe('open');
  expect(screen.getByRole('button', { name: 'Comment thread: Hello' })).toBeDefined();
  expect(screen.getByRole('dialog', { name: 'Comment thread' })).toBeDefined();
  store.destroy();
});

it('a switch that waits for the store still opens the thread chosen with it', () => {
  const { calls, flush, selection, store } = twoPages({ isDeferred: true });
  fireEvent.click(panelItem('Hello'));
  expect(calls).toEqual([`show ${DEFAULT_PAGE_ID}`, 'select open']);
  expect(selection.id).toBe('open');
  act(flush);
  // The switch lands after the selection and does not close it: the card stays open (its pin is
  // drawn on the next frame, which this test does not run).
  expect(calls).toEqual([`show ${DEFAULT_PAGE_ID}`, 'select open']);
  expect(selection.id).toBe('open');
  expect(screen.getByRole('dialog', { name: 'Comment thread' })).toBeDefined();
  store.destroy();
});

it('a thread whose pin the service keeps shows that pin’s page too', () => {
  const { calls, selection, store } = twoPages();
  fireEvent.click(panelItem('Kept by the service'));
  expect(calls).toEqual([`show ${DEFAULT_PAGE_ID}`, 'select service']);
  expect(selection.id).toBe('service');
  expect(screen.getByRole('button', { name: 'Comment thread: Kept by the service' })).toBeDefined();
  store.destroy();
});

it('a thread on the page shown opens without a switch', () => {
  const { calls, pages, selection, store } = twoPages();
  fireEvent.click(panelItem('On the whiteboard'));
  expect(pages.show).not.toHaveBeenCalled();
  expect(calls).toEqual(['select shown']);
  expect(selection.id).toBe('shown');
  store.destroy();
});

it('a switch to another page closes a card whose pin is not on it', () => {
  const { calls, pages, selection, store, whiteboard } = twoPages();
  fireEvent.click(panelItem('On the whiteboard'));
  act(() => {
    pages.show(DEFAULT_PAGE_ID);
  });
  expect(calls).toEqual(['select shown', `show ${DEFAULT_PAGE_ID}`, 'close']);
  expect(selection.id).toBeUndefined();
  expect(screen.queryByRole('dialog', { name: 'Comment thread' })).toBeNull();
  // Back on its page the thread stays closed: the switch closed it, it does not hide it.
  act(() => {
    pages.show(whiteboard);
  });
  expect(selection.id).toBeUndefined();
  store.destroy();
});
