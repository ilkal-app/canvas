// @vitest-environment jsdom
// A service pin's spot follows its object until the person's own change deletes the object or
// moves it off the pin's page: then the pin stays where it last showed.
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  addPageCommand,
  createObjectCommand,
  deleteObjectsCommand,
  moveObjectsCommand,
  moveObjectsToPageCommand,
  runCommand,
  SYSTEM_ORIGIN,
} from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { commentRequest, type Thread } from './comment-api.js';
import { useKeepPinFallbacks } from './comment-pin-fallback.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(commentRequest).mockReset().mockResolvedValue({});
});

const environment = { clock: () => 1, createId: () => 'other-page' as ObjectId };

/** A thread pinned in the service to the note, 5 and 6 into it. */
const thread: Thread = {
  id: 'thread',
  pinId: 'pin',
  isResolved: false,
  messages: [],
  pin: {
    pageId: DEFAULT_PAGE_ID,
    anchor: { kind: 'object', objectId: 'note', offset: { x: 5, y: 6 } },
    point: { x: 0, y: 0 },
  },
};

/**
 * A board with the note at 100, 200, and the hook watching it.
 *
 * @param canEdit - Whether the person may edit the board.
 * @returns The connection and the reread.
 */
function setUp(canEdit = true) {
  const connection = new FakeBoardConnection('board');
  runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'shape',
        id: 'note',
        x: 100,
        y: 200,
        width: 80,
        height: 40,
        kind: 'rectangle',
        stroke: null,
        fill: [1, 1, 1, 1],
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
    },
    environment,
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  renderHook(() => {
    useKeepPinFallbacks({ boardId: 'board', threads: [thread], connection, canEdit, refresh });
  });
  return { connection, refresh };
}

it('keeps the pin where its moved object was when the person deletes the object', async () => {
  const { connection, refresh } = setUp();
  runCommand(
    connection.store,
    connection.origin,
    moveObjectsCommand,
    { moves: [{ id: 'note', by: { x: 10, y: 20 } }] },
    environment,
  );
  expect(commentRequest).not.toHaveBeenCalled();
  runCommand(
    connection.store,
    connection.origin,
    deleteObjectsCommand,
    { ids: ['note'] },
    environment,
  );
  expect(commentRequest).toHaveBeenCalledExactlyOnceWith('board', 'PUT', '/thread/pin', {
    pin: { ...thread.pin, point: { x: 115, y: 226 } },
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledOnce();
  });
  connection.store.destroy();
});

it('keeps the pin where its object was when the person moves the object to another page', () => {
  const { connection } = setUp();
  runCommand(connection.store, connection.origin, addPageCommand, { name: 'Two' }, environment);
  runCommand(
    connection.store,
    connection.origin,
    moveObjectsToPageCommand,
    { ids: ['note'], pageId: 'other-page' },
    environment,
  );
  expect(commentRequest).toHaveBeenCalledExactlyOnceWith('board', 'PUT', '/thread/pin', {
    pin: { ...thread.pin, point: { x: 105, y: 206 } },
  });
  connection.store.destroy();
});

it('writes nothing for a person who may not edit, or for a system change', () => {
  const viewer = setUp(false);
  runCommand(
    viewer.connection.store,
    viewer.connection.origin,
    deleteObjectsCommand,
    { ids: ['note'] },
    environment,
  );
  const editor = setUp();
  runCommand(
    editor.connection.store,
    SYSTEM_ORIGIN,
    deleteObjectsCommand,
    { ids: ['note'] },
    environment,
  );
  expect(commentRequest).not.toHaveBeenCalled();
  viewer.connection.store.destroy();
  editor.connection.store.destroy();
});
