// @vitest-environment jsdom
// CONTRACT: selection subscriptions live only with the card, and hidden resolved pins never affect clusters.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardViewChange } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { shellBoardModeContext } from '../shell/shell-board-mode.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Thread } from './comment-api.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { placeThreadPin } from './comment-placement.js';

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeThread(id: string, isResolved = false): Thread {
  return {
    id,
    pinId: `pin-${id}`,
    isResolved,
    messages: [
      {
        id: `message-${id}`,
        authorId: 'other',
        authorName: 'Other',
        text: id,
        mentions: [],
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

function makeData(threads: Thread[], selectedId?: string): CommentData {
  const connection = new FakeBoardConnection('board');
  threads.forEach((thread, index) =>
    placeThreadPin(
      connection,
      {
        id: thread.pinId as ObjectId,
        point: { x: 100 + index * 10, y: 200 },
        anchor: { kind: 'point' },
      },
      thread.id,
    ),
  );
  return {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads,
    selectedId,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: true,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  };
}

function makeEngine() {
  let selectedIds: readonly ObjectId[] = [];
  const listeners = new Set<(change: BoardViewChange) => void>();
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    board: {
      state: () => ({ selectedIds, documentVersion: 0, enteredGroupId: null }),
      subscribe: (listener: (change: BoardViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    runCanvasAction: vi.fn(),
  } as unknown as MountedEngine;
  return {
    engine,
    listeners,
    select: (ids: string[]) => {
      selectedIds = ids as ObjectId[];
      act(() => {
        for (const listener of listeners) listener({ kind: 'selection' });
      });
    },
  };
}

function show(data: CommentData, engine: MountedEngine, isResolvedShown = false, canWrite = true) {
  return render(
    <shellBoardModeContext.Provider
      value={{
        mode: 'whiteboard',
        changeMode: () => undefined,
        drawers: { hasLayersDrawer: false, hasInspector: false },
      }}
    >
      <commentContext.Provider
        value={{
          canWrite,
          isPlacing: false,
          isPanelOpen: false,
          setPlacing: vi.fn(),
          togglePanel: vi.fn(),
          isResolvedShown,
          toggleResolvedShown: vi.fn(),
        }}
      >
        <commentDataContext.Provider value={data}>
          <canvas />
          <CommentOverlay engine={engine} />
        </commentDataContext.Provider>
      </commentContext.Provider>
    </shellBoardModeContext.Provider>,
  );
}

it('subscribes again after closing and reopening, then closes on a different non-empty selection', () => {
  const selection = makeEngine();
  const data = makeData([makeThread('first')], 'first');
  const view = show(data, selection.engine);
  expect(selection.listeners.size).toBe(1);
  selection.select(['object-a']);
  expect((data.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  view.rerender(
    <shellBoardModeContext.Provider
      value={{
        mode: 'whiteboard',
        changeMode: () => undefined,
        drawers: { hasLayersDrawer: false, hasInspector: false },
      }}
    >
      <commentContext.Provider
        value={{
          canWrite: true,
          isPlacing: false,
          isPanelOpen: false,
          setPlacing: vi.fn(),
          togglePanel: vi.fn(),
        }}
      >
        <commentDataContext.Provider value={{ ...data, selectedId: undefined }}>
          <canvas />
          <CommentOverlay engine={selection.engine} />
        </commentDataContext.Provider>
      </commentContext.Provider>
    </shellBoardModeContext.Provider>,
  );
  expect(selection.listeners.size).toBe(0);
  selection.select(['object-b']);
  expect((data.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  view.unmount();
  const reopened = show({ ...data, selectedId: 'first' }, selection.engine);
  expect(selection.listeners.size).toBe(1);
  selection.select(['object-c']);
  expect((data.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  reopened.unmount();
  expect(selection.listeners.size).toBe(0);
});

it('keeps the card open when Escape first dismisses its open More menu', () => {
  const selection = makeEngine();
  const data = makeData([makeThread('first')], 'first');
  show(data, selection.engine);
  const card = screen.getByRole('dialog', { name: 'Comment thread' });
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('menu', { name: 'More' }), { key: 'Escape' });
  expect(screen.queryByRole('menu', { name: 'More' })).toBeNull();
  expect(card).toBeTruthy();
  expect((data.close as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
});

it('excludes a hidden resolved pin from cluster count and frame members', () => {
  const selection = makeEngine();
  const data = makeData([makeThread('first'), makeThread('hidden', true), makeThread('third')]);
  const view = show(data, selection.engine);
  expect(screen.getByRole('button', { name: '2 comment threads: zoom to them' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '3 comment threads: zoom to them' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '2 comment threads: zoom to them' }));
  expect((selection.engine.runCanvasAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual(
    {
      type: 'frame',
      bounds: { minX: 100, minY: 200, maxX: 120, maxY: 200 },
    },
  );
  view.unmount();
  show(data, selection.engine, true);
  expect(screen.getByRole('button', { name: '3 comment threads: zoom to them' })).toBeTruthy();
});

it('hides a resolved pin for a viewer and reveals it when visibility is toggled', () => {
  const selection = makeEngine();
  const data = makeData([makeThread('resolved', true)]);
  const hidden = show(data, selection.engine, false, false);
  expect(screen.queryByRole('button', { name: 'Comment thread: resolved' })).toBeNull();
  hidden.unmount();
  const shown = show(data, selection.engine, true, false);
  expect(screen.getByRole('button', { name: 'Comment thread: resolved' })).toBeTruthy();
  shown.unmount();
  show(data, selection.engine, false, false);
  expect(screen.queryByRole('button', { name: 'Comment thread: resolved' })).toBeNull();
});
