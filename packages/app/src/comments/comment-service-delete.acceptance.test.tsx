// CONTRACT: a starter deletes their sole new comment in one action; replied-to and others' threads still ask.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_ID } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Message, type Thread } from './comment-api.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
const message = (authorId: string): Message => ({
  id: authorId,
  authorId,
  authorName: authorId,
  text: 'Check this',
  mentions: [],
  createdAt: new Date(0).toISOString(),
});
const pin = { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' as const }, point: { x: 1, y: 2 } };
function show(thread: Thread) {
  const connection = new FakeBoardConnection('board');
  const deleteThread = vi.fn().mockResolvedValue(undefined);
  const data = {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads: [thread],
    selectedId: thread.id,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: true,
    deleteThread,
    change: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  } satisfies CommentData;
  render(<CommentDialog data={data} canWrite isWhiteboard />);
  return { connection, deleteThread };
}
const makeThread = (starterId: string, messages: Message[]): Thread => ({
  id: 'thread',
  pinId: 'pin',
  pin,
  starterId,
  isResolved: false,
  messages,
});

it('deletes the starter’s single-message service thread directly', () => {
  const { connection, deleteThread } = show(makeThread(FAKE_PERSON.id, [message(FAKE_PERSON.id)]));
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread' }));
  expect(deleteThread).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group', { name: 'Delete this thread?' })).toBeNull();
  connection.store.destroy();
});

it.each([
  ['a reply', makeThread(FAKE_PERSON.id, [message(FAKE_PERSON.id), message('other')])],
  ['another starter', makeThread('other', [message('other')])],
])('asks before deleting a thread with %s', (caseName, thread) => {
  expect(caseName).toBeTruthy();
  const { connection, deleteThread } = show(thread);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread' }));
  expect(screen.getByRole('group', { name: 'Delete this thread?' })).toBeDefined();
  expect(deleteThread).not.toHaveBeenCalled();
  connection.store.destroy();
});

it('deletes a service-pinned thread through the service without a document command', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  const thread = makeThread(FAKE_PERSON.id, [message(FAKE_PERSON.id)]);
  vi.mocked(commentRequest)
    .mockReset()
    .mockImplementation((...[, method]) =>
      Promise.resolve(method === 'GET' ? { threads: [thread] } : {}),
    );
  let state: CommentData | undefined;
  function Probe() {
    state = useContext(commentDataContext);
    return null;
  }
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
    expect(state?.threads).toEqual([thread]);
  });
  const before = connection.store.encodeState();
  await act(async () => {
    await state?.deleteThread(thread);
  });
  expect(commentRequest).toHaveBeenCalledWith('board', 'DELETE', '/thread', undefined);
  expect(connection.store.encodeState()).toEqual(before);
  view.unmount();
  connection.store.destroy();
});
