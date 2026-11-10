// CONTRACT: a pin lets a thread starter or board editor drag a service pin, hit-tests the drop, and distinguishes click, cancel, and failed saves.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread, type ThreadPin } from './comment-api.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
beforeEach(() => {
  vi.mocked(commentRequest).mockReset().mockResolvedValue({ threads: [] });
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

const pin: ThreadPin = {
  pageId: DEFAULT_PAGE_ID,
  anchor: { kind: 'point' },
  point: { x: 50, y: 60 },
};
const thread: Thread = {
  id: 'thread',
  pinId: 'legacy-pin',
  starterId: FAKE_PERSON.id,
  isResolved: false,
  pin,
  messages: [
    {
      id: 'message',
      authorId: FAKE_PERSON.id,
      authorName: 'Owner',
      text: 'Move me',
      mentions: [],
      createdAt: new Date(0).toISOString(),
    },
  ],
};

function fixture(changes: Partial<Thread> = {}, canEditBoard = false) {
  const connection = new FakeBoardConnection('board');
  const current = { ...thread, ...changes };
  if (current.pin == null) {
    runCommand(
      connection.store,
      connection.origin,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: current.pinId,
          x: 50,
          y: 60,
          threadId: current.id,
          anchor: { kind: 'point' },
        },
      },
      { clock: () => 1, createId: () => 'unused' as ObjectId },
    );
  }
  const data = {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads: [current],
    selectedId: undefined,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard,
    movePin: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(),
    close: vi.fn(),
    place: vi.fn(),
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  } satisfies CommentData;
  const camera = { x: 10, y: 20, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
  const engine = {
    camera: () => camera,
    pages: { current: () => DEFAULT_PAGE_ID, subscribe: () => () => undefined },
    board: { state: () => ({ selectedIds: [] }), subscribe: () => () => undefined },
  } as unknown as MountedEngine;
  const view = render(
    <commentContext.Provider
      value={{
        canWrite: true,
        isPlacing: false,
        isPanelOpen: false,
        setPlacing: vi.fn(),
        togglePanel: vi.fn(),
      }}
    >
      <commentDataContext.Provider value={data}>
        <canvas />
        <CommentOverlay engine={engine} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  const button = screen.getByRole('button', { name: 'Comment thread: Move me' });
  return { connection, data, button, unmount: view.unmount };
}

function gesture(
  button: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.click(button);
}

it('drags at 4 CSS px, follows the pointer, and saves one point pin on release without opening', async () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 84, clientY: 80 });
  expect(f.button.style.left).toBe('84px');
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 120 });
  fireEvent.click(f.button);
  await waitFor(() => {
    expect(f.data.movePin).toHaveBeenCalledExactlyOnceWith(f.data.threads[0], {
      pageId: DEFAULT_PAGE_ID,
      anchor: { kind: 'point' },
      point: { x: 60, y: 80 },
    });
  });
  expect(f.data.select).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('anchors the dropped pin to an object with its local offset', async () => {
  const f = fixture();
  runCommand(
    f.connection.store,
    f.connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'shape',
        id: 'target',
        x: 100,
        y: 200,
        width: 100,
        height: 50,
        kind: 'rectangle',
        stroke: null,
        fill: [1, 1, 1, 1],
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
    },
    { clock: () => 1, createId: () => 'unused' as ObjectId },
  );
  gesture(f.button, { x: 80, y: 80 }, { x: 200, y: 380 });
  await waitFor(() => {
    expect(f.data.movePin).toHaveBeenCalledExactlyOnceWith(f.data.threads[0], {
      pageId: DEFAULT_PAGE_ID,
      anchor: { kind: 'object', objectId: 'target', offset: { x: 10, y: 10 } },
      point: { x: 110, y: 210 },
    });
  });
  expect(f.data.select).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it('cancels a drag on Escape and restores its old position', () => {
  const f = fixture();
  fireEvent.pointerDown(f.button, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(f.button.style.left).toBe('100px');
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(f.button.style.left).toBe('80px');
  expect(f.data.movePin).not.toHaveBeenCalled();
  expect(f.data.select).not.toHaveBeenCalled();
  f.connection.store.destroy();
});

it.each([
  ['another commenter', { starterId: 'other' }, false, false],
  ['an editor moving another member’s pin', { starterId: 'other' }, true, true],
  ['a legacy document pin', { pin: null }, true, false],
] as const)('%s has the expected drag permission', async (role, changes, canEdit, canDrag) => {
  expect(role).toBeTruthy();
  const f = fixture(changes, canEdit);
  gesture(f.button, { x: 80, y: 80 }, { x: 100, y: 120 });
  if (canDrag)
    await waitFor(() => {
      expect(f.data.movePin).toHaveBeenCalledOnce();
    });
  else expect(f.data.movePin).not.toHaveBeenCalled();
  expect(f.data.select).toHaveBeenCalledTimes(canDrag ? 0 : 1);
  f.connection.store.destroy();
});

let providerData: CommentData | undefined;
function Probe(): null {
  providerData = useContext(commentDataContext);
  return null;
}

it('uses the provider PUT and refresh path, and restores the pin with the usual error after failure', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  vi.mocked(commentRequest).mockImplementation((...[, method]) =>
    method === 'GET'
      ? Promise.resolve({ threads: [thread] })
      : Promise.reject(new Error('offline')),
  );
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={() => false}
    >
      <Probe />
    </CommentProvider>,
  );
  await waitFor(() => {
    expect(providerData?.threads).toHaveLength(1);
  });
  const moved = {
    pageId: DEFAULT_PAGE_ID,
    anchor: { kind: 'point' as const },
    point: { x: 70, y: 90 },
  };
  await act(async () => {
    await expect(providerData?.movePin?.(thread, moved)).rejects.toThrow('offline');
  });
  expect(commentRequest).toHaveBeenCalledWith('board', 'PUT', '/thread/pin', { pin: moved });
  expect(providerData?.error).toBe(
    'Your change could not be saved. Check your connection and try again.',
  );
  expect(providerData?.threads[0]?.pin).toEqual(pin);
  view.unmount();
  connection.store.destroy();
});

it('sends one PUT without adopt and reads the threads again after a successful move', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  vi.mocked(commentRequest).mockResolvedValue({ threads: [thread] });
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={() => false}
    >
      <Probe />
    </CommentProvider>,
  );
  await waitFor(() => {
    expect(providerData?.threads).toHaveLength(1);
  });
  vi.mocked(commentRequest).mockClear();
  const moved: ThreadPin = {
    pageId: DEFAULT_PAGE_ID,
    anchor: { kind: 'point' },
    point: { x: 70, y: 90 },
  };
  await act(async () => {
    await providerData?.movePin?.(thread, moved);
  });
  expect(commentRequest).toHaveBeenNthCalledWith(1, 'board', 'PUT', '/thread/pin', { pin: moved });
  expect(commentRequest).toHaveBeenNthCalledWith(2, 'board', 'GET');
  view.unmount();
  connection.store.destroy();
});

it('restores the displayed pin and shows the card error when the drag PUT fails', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  vi.mocked(commentRequest).mockImplementation((...[, method]) =>
    method === 'GET'
      ? Promise.resolve({ threads: [thread] })
      : Promise.reject(new Error('offline')),
  );
  const engine = {
    camera: () => ({ x: 10, y: 20, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    pages: { current: () => DEFAULT_PAGE_ID, subscribe: () => () => undefined },
    board: { state: () => ({ selectedIds: [] }), subscribe: () => () => undefined },
  } as unknown as MountedEngine;
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={() => false}
    >
      <canvas />
      <CommentOverlay engine={engine} />
      <Probe />
    </CommentProvider>,
  );
  await screen.findByRole('button', { name: 'Comment thread: Move me' });
  act(() => {
    providerData?.select(thread.id);
  });
  const live = screen.getByRole('button', { name: 'Comment thread: Move me' });
  gesture(live, { x: 80, y: 80 }, { x: 120, y: 120 });
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain(
      'Your change could not be saved. Check your connection and try again.',
    );
  });
  expect(live.style.left).toBe('80px');
  expect(live.style.top).toBe('80px');
  view.unmount();
  connection.store.destroy();
});
