// CONTRACT: each legacy document pin is adopted once, a failed adoption is retried on a later list, and nothing is written for viewers.
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createApiTransport } from '../service/api-transport.js';

import type { Thread } from './comment-api.js';
import { useAdoptPins } from './comment-pin-adoption.js';

vi.mock('../service/api-transport.js', () => ({ createApiTransport: vi.fn() }));
afterEach(cleanup);
const send = vi.fn();
beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined);
  vi.mocked(createApiTransport).mockReturnValue(send);
});
const legacy: Thread = {
  id: 'thread',
  pinId: 'old-pin',
  isResolved: false,
  messages: [],
  pin: null,
};
const set: Thread = {
  ...legacy,
  id: 'set',
  pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point: { x: 4, y: 5 } },
};
function addComment(connection: FakeBoardConnection, id: string, x: number, y: number) {
  runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id,
        x,
        y,
        threadId: 'thread',
        anchor: { kind: 'point' },
      },
    },
    { clock: () => 1, createId: () => 'unused' as ObjectId },
  );
}
function setup() {
  const connection = new FakeBoardConnection('board');
  addComment(connection, 'old-pin', 12, 34);
  return connection;
}
const request = {
  method: 'PUT',
  path: '/api/boards/board/threads/thread/pin',
  body: {
    pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point: { x: 12, y: 34 } },
    adopt: true,
  },
};

it('adopts by pinId, sends the exact pin, then refreshes once', async () => {
  const connection = setup();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { rerender, unmount } = renderHook(
    ({ threads }) => {
      useAdoptPins({ boardId: 'board', threads, connection, canWrite: true, refresh });
    },
    { initialProps: { threads: [legacy, set] } },
  );
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith(expect.objectContaining(request));
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledOnce();
  });
  rerender({ threads: [...[legacy, set]] });
  expect(send).toHaveBeenCalledOnce();
  unmount();
  connection.store.destroy();
});

it('does not adopt a same-thread copy when the pinId object is gone', () => {
  const connection = new FakeBoardConnection('board');
  addComment(connection, 'copied-pin', 56, 78);
  const refresh = vi.fn();
  const { unmount } = renderHook(() => {
    useAdoptPins({ boardId: 'board', threads: [legacy], connection, canWrite: true, refresh });
  });
  expect(send).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  unmount();
  connection.store.destroy();
});

it('adopts the pinId object when a same-thread copy was created first', async () => {
  const connection = new FakeBoardConnection('board');
  addComment(connection, 'copied-pin', 56, 78);
  addComment(connection, 'old-pin', 12, 34);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() => {
    useAdoptPins({ boardId: 'board', threads: [legacy], connection, canWrite: true, refresh });
  });
  await waitFor(() => {
    expect(send).toHaveBeenCalledOnce();
  });
  expect(send).toHaveBeenCalledWith(expect.objectContaining(request));
  unmount();
  connection.store.destroy();
});

it('does not start a second request while the first is in flight', async () => {
  const connection = setup();
  let resolve!: () => void;
  send.mockImplementation(
    () =>
      new Promise<void>((accept) => {
        resolve = accept;
      }),
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { rerender, unmount } = renderHook(
    ({ threads }) => {
      useAdoptPins({ boardId: 'board', threads, connection, canWrite: true, refresh });
    },
    { initialProps: { threads: [legacy] } },
  );
  await waitFor(() => {
    expect(send).toHaveBeenCalledOnce();
  });
  rerender({ threads: [{ ...legacy }] });
  expect(send).toHaveBeenCalledOnce();
  act(() => {
    resolve();
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledOnce();
  });
  unmount();
  connection.store.destroy();
});

it('retries a failure after the thread list changes', async () => {
  const connection = setup();
  send.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { rerender, unmount } = renderHook(
    ({ threads }) => {
      useAdoptPins({ boardId: 'board', threads, connection, canWrite: true, refresh });
    },
    { initialProps: { threads: [legacy] } },
  );
  await waitFor(() => {
    expect(send).toHaveBeenCalledOnce();
  });
  expect(refresh).not.toHaveBeenCalled();
  rerender({ threads: [{ ...legacy }] });
  await waitFor(() => {
    expect(send).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledOnce();
  });
  unmount();
  connection.store.destroy();
});

it('does not adopt for a viewer', () => {
  const connection = setup();
  const { unmount } = renderHook(() => {
    useAdoptPins({
      boardId: 'board',
      threads: [legacy],
      connection,
      canWrite: false,
      refresh: vi.fn(),
    });
  });
  expect(send).not.toHaveBeenCalled();
  unmount();
  connection.store.destroy();
});

it('adopts by pinId an object anchor with its resolved board point', async () => {
  const connection = new FakeBoardConnection('board');
  const environment = { clock: () => 1, createId: () => 'unused' as ObjectId };
  runCommand(
    connection.store,
    connection.origin,
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
        stroke: { color: [0, 0, 0, 1], width: 2 },
        fill: [1, 1, 1, 1],
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
    },
    environment,
  );
  runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id: 'fallback-pin',
        x: 1,
        y: 2,
        threadId: 'other-thread',
        anchor: { kind: 'object', objectId: 'target', offset: { x: 3, y: 4 } },
      },
    },
    environment,
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() => {
    useAdoptPins({
      boardId: 'board',
      threads: [{ ...legacy, id: 'fallback', pinId: 'fallback-pin' }],
      connection,
      canWrite: true,
      refresh,
    });
  });
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        path: '/api/boards/board/threads/fallback/pin',
        body: {
          adopt: true,
          pin: {
            pageId: DEFAULT_PAGE_ID,
            anchor: { kind: 'object', objectId: 'target', offset: { x: 3, y: 4 } },
            point: { x: 103, y: 204 },
          },
        },
      }),
    );
  });
  unmount();
  connection.store.destroy();
});
