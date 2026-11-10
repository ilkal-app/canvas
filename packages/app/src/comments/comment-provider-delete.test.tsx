// @vitest-environment jsdom
// The provider's thread deletion: the card's "Delete thread" through the pin, the pin
// watcher's service writes, and a commenter's direct delete.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  createHistory,
  createObjectCommand,
  deleteObjectsCommand,
  runCommand,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread } from './comment-api.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  // The pins' thread is listed, still pinned by the document: the cleanup keeps its pins,
  // as it would every pin of a thread the service has no pin for.
  vi.mocked(commentRequest)
    .mockReset()
    .mockResolvedValue({ threads: [thread] });
});
let state: CommentData;

/**
 * Publishes the comment data for the tests to act on.
 *
 * @returns Nothing visible.
 */
function Probe(): null {
  const data = useContext(commentDataContext);
  if (data) state = data;
  return null;
}

/**
 * Renders the provider over a fake board.
 *
 * @param isReadOnly - Whether the person may only view the document (a commenter).
 * @param canComment - Whether they may write comments though not edit.
 * @returns The board, the member lookup and the view.
 */
function setup(isReadOnly = false, canComment = false) {
  const connection = new FakeBoardConnection('board', undefined, isReadOnly);
  const client = new FakeMemberDirectory();
  const members = vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={() => false}
      canComment={canComment}
    >
      <Probe />
    </CommentProvider>,
  );
  return { connection, members, view };
}

const thread: Thread = { id: 'thread', pinId: 'pin', isResolved: false, messages: [] };
const PIN = 'pin' as ObjectId;
const ENVIRONMENT = { clock: () => 0, createId: () => 'unused' as ObjectId };

/**
 * Writes a comment pin for the thread as the person.
 *
 * @param connection - The board.
 * @param pinId - The pin's id.
 * @throws {Error} When the pin is not placed.
 */
function placePin(connection: FakeBoardConnection, pinId = PIN): void {
  const result = runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id: pinId,
        x: 0,
        y: 0,
        threadId: 'thread',
        anchor: { kind: 'point' },
      },
    },
    ENVIRONMENT,
  );
  if (result.status !== 'applied') throw new Error('pin not placed');
}

it('deletes a thread through its pin for an editor, and restores it when undo brings the pin back', async () => {
  const f = setup();
  const history = createHistory(f.connection.store, f.connection.origin.principalId);
  placePin(f.connection);
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockClear();
  await act(async () => {
    await state.deleteThread(thread);
  });
  expect(f.connection.store.get(PIN)).toBeUndefined();
  expect(commentRequest).toHaveBeenCalledWith('board', 'DELETE', '/thread');
  act(() => {
    history.undo();
  });
  expect(f.connection.store.get(PIN)?.type).toBe('comment');
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith('board', 'POST', '/thread/restore');
  });
  history.destroy();
  f.view.unmount();
  f.connection.store.destroy();
});

it('deletes a commenter’s thread in the service directly, and tells when a pin’s thread could not be deleted', async () => {
  const f = setup(true, true);
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockClear();
  await act(async () => {
    await state.deleteThread(thread);
  });
  expect(commentRequest).toHaveBeenCalledWith('board', 'DELETE', '/thread', undefined);
  f.view.unmount();
  f.connection.store.destroy();

  const g = setup();
  placePin(g.connection);
  await waitFor(() => {
    expect(g.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockImplementation((...[, method]) =>
    method === 'GET'
      ? Promise.resolve({ threads: [thread] })
      : Promise.reject(new Error('offline')),
  );
  act(() => {
    runCommand(
      g.connection.store,
      g.connection.origin,
      deleteObjectsCommand,
      { ids: [PIN] },
      ENVIRONMENT,
    );
  });
  await waitFor(() => {
    expect(state.error).toBe('A comment could not be deleted or restored. Try again.');
  });
  g.view.unmount();
  g.connection.store.destroy();
});

it('deletes every pin of the thread from the card, so the thread goes with the last', async () => {
  const f = setup();
  placePin(f.connection);
  placePin(f.connection, 'pin-copy' as ObjectId);
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockClear();
  await act(async () => {
    await state.deleteThread(thread);
  });
  expect(f.connection.store.get(PIN)).toBeUndefined();
  expect(f.connection.store.get('pin-copy' as ObjectId)).toBeUndefined();
  const deletes = vi.mocked(commentRequest).mock.calls.filter(([, method]) => method === 'DELETE');
  expect(deletes).toEqual([['board', 'DELETE', '/thread']]);
  f.view.unmount();
  f.connection.store.destroy();
});
