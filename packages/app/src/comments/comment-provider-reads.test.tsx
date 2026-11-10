// @vitest-environment jsdom
// Read marks in the comment provider: opening an unread thread marks it read in the
// boards service and reads the list again; the mode carries the unread counts.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread } from './comment-api.js';
import { commentContext, type CommentMode } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));

afterEach(cleanup);

/** When the person last read the thread. */
const READ_AT = '2026-10-21T10:05:00.000Z';

/** An open thread with a message by someone else after the person's mark. */
const UNREAD: Thread = {
  id: 'thread',
  pinId: 'pin',
  isResolved: false,
  lastReadAt: READ_AT,
  messages: [
    {
      id: 'm',
      authorId: 'other',
      authorName: 'Other',
      text: 'Ping @you',
      mentions: [FAKE_PERSON.id],
      createdAt: '2026-10-21T10:09:00.000Z',
    },
  ],
};

/** The same thread once the person has read it. */
const READ: Thread = { ...UNREAD, lastReadAt: '2026-10-21T10:10:00.000Z' };

let data: CommentData | undefined;
let mode: CommentMode | undefined;

/**
 * Reads the provider's contexts into the test.
 *
 * @returns Nothing.
 */
function Probe(): null {
  data = useContext(commentDataContext);
  mode = useContext(commentContext);
  return null;
}

/**
 * The provider over a fake connection.
 *
 * @returns The connection.
 */
function setup(): FakeBoardConnection {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  Object.assign(connection, { onThreadsChanged: () => () => undefined });
  render(
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
  return connection;
}

beforeEach(() => {
  data = undefined;
  mode = undefined;
});

it('counts unread threads and mentions, and marks an opened unread thread read', async () => {
  let threads: Thread[] = [UNREAD];
  vi.mocked(commentRequest)
    .mockReset()
    .mockImplementation((...[, method, suffix]) => {
      if (method === 'POST' && suffix === '/thread/read') {
        threads = [READ];
        return Promise.resolve({});
      }
      return Promise.resolve({ threads });
    });
  const connection = setup();
  await waitFor(() => {
    expect(mode?.unread).toEqual({ threads: 1, mentions: 1 });
  });
  act(() => {
    data?.select('thread');
  });
  await waitFor(() => {
    expect(mode?.unread).toEqual({ threads: 0, mentions: 0 });
  });
  const marks = vi
    .mocked(commentRequest)
    .mock.calls.filter(([, method, suffix]) => method === 'POST' && suffix === '/thread/read');
  expect(marks).toHaveLength(1);
  connection.store.destroy();
});

it('asks once per unread state, and again after a failed request when a reply arrives', async () => {
  let threads: Thread[] = [UNREAD];
  let marks = 0;
  vi.mocked(commentRequest)
    .mockReset()
    .mockImplementation((...[, method, suffix]) => {
      if (method === 'POST' && suffix === '/thread/read') {
        marks += 1;
        return Promise.reject(new Error('An older service'));
      }
      return Promise.resolve({ threads });
    });
  const connection = setup();
  await waitFor(() => {
    expect(mode?.unread?.threads).toBe(1);
  });
  act(() => {
    data?.select('thread');
  });
  await waitFor(() => {
    expect(marks).toBe(1);
  });
  // Still unread after the failure; a new message is a new unread state, asked again.
  const reply = { ...UNREAD.messages[0], id: 'n', createdAt: '2026-10-21T10:11:00.000Z' };
  threads = [{ ...UNREAD, messages: [...UNREAD.messages, reply] } as Thread];
  await act(async () => {
    await data?.refresh();
  });
  await waitFor(() => {
    expect(marks).toBe(2);
  });
  expect(mode?.unread?.threads).toBe(1);
  connection.store.destroy();
});

it('marks nothing for a thread already read, or with no open thread', async () => {
  vi.mocked(commentRequest)
    .mockReset()
    .mockResolvedValue({ threads: [READ] });
  const connection = setup();
  await waitFor(() => {
    expect(data?.threads).toHaveLength(1);
  });
  act(() => {
    data?.select('thread');
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(vi.mocked(commentRequest).mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  expect(mode?.unread).toEqual({ threads: 0, mentions: 0 });
  connection.store.destroy();
});
