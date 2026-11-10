// @vitest-environment jsdom
// Once the session ended, comments ask the
// service nothing and write nothing, a request begun before it included (no pin, no reload).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread } from './comment-api.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { commentPlacement } from './comment-placement.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(commentRequest).mockReset().mockResolvedValue({ threads: [] });
});
let state: CommentData;
function Probe() {
  const data = useContext(commentDataContext);
  const mode = useContext(commentContext);
  if (!data || !mode) throw new Error('missing comments context');
  state = data;
  return (
    <>
      <span>{data.threads.map((thread) => thread.id).join(',')}</span>
      <span role="alert">{data.error}</span>
      <button
        onClick={() => {
          mode.togglePanel();
        }}
      >
        Toggle
      </button>
      <span>
        {String(mode.isPanelOpen)}:{String(mode.isPlacing)}
      </span>
    </>
  );
}

function setup(isReadOnly = false, onSessionError = vi.fn(() => false), canComment = false) {
  const connection = new FakeBoardConnection('board', undefined, isReadOnly);
  const client = new FakeMemberDirectory();
  const members = vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  let notice: (() => void) | undefined;
  const unsubscribe = vi.fn();
  Object.assign(connection, {
    onThreadsChanged: (listener: () => void) => {
      notice = listener;
      return unsubscribe;
    },
  });
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={onSessionError}
      canComment={canComment}
    >
      <Probe />
    </CommentProvider>,
  );
  return { connection, members, onSessionError, view, unsubscribe, notice: () => notice?.() };
}

const thread: Thread = { id: 'thread', pinId: 'pin', isResolved: false, messages: [] };

it('asks nothing of the service and writes nothing once the session ended', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  const members = vi.spyOn(client, 'listMembers');
  render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={vi.fn(() => false)}
      isSessionEnded
    >
      <Probe />
    </CommentProvider>,
  );
  await act(async () => {
    await state.change('/threads', { body: 'late' });
  });
  expect(commentRequest).not.toHaveBeenCalled();
  expect(members).not.toHaveBeenCalled();
  expect(screen.getByText('false:false')).toBeTruthy();
  connection.store.destroy();
});

it('drops a comment that answers after the session ended: no pin, no reload', async () => {
  const f = setup();
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  act(() => {
    state.place(commentPlacement(f.connection.store.read(), { x: 10, y: 20 }));
  });
  let answer: (value: { thread: Thread }) => void = () => undefined;
  vi.mocked(commentRequest).mockReset();
  vi.mocked(commentRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  let sent: Promise<void> = Promise.resolve();
  act(() => {
    sent = state.change('', { text: 'Late' });
  });
  expect(commentRequest).toHaveBeenCalledTimes(1);
  // The session ends while the comment is in flight.
  f.view.rerender(
    <CommentProvider
      connection={f.connection}
      boardId="board"
      user={FAKE_PERSON}
      client={new FakeMemberDirectory()}
      onSessionError={f.onSessionError}
      isSessionEnded
    >
      <Probe />
    </CommentProvider>,
  );
  await act(async () => {
    answer({ thread });
    await sent;
  });
  expect(f.connection.store.read().objects.size).toBe(0);
  // No reload either: the only request was the comment itself.
  expect(commentRequest).toHaveBeenCalledTimes(1);
  f.connection.store.destroy();
});

it('drops a comment once the session check says it ended, before the page re-renders', async () => {
  let isEnded = false;
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
  render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={vi.fn(() => false)}
      hasSessionEnded={() => isEnded}
    >
      <Probe />
    </CommentProvider>,
  );
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith('board', 'GET');
  });
  act(() => {
    state.place(commentPlacement(connection.store.read(), { x: 10, y: 20 }));
  });
  let answer: (value: { thread: Thread }) => void = () => undefined;
  vi.mocked(commentRequest).mockReset();
  vi.mocked(commentRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  let sent: Promise<void> = Promise.resolve();
  act(() => {
    sent = state.change('', { text: 'Late' });
  });
  isEnded = true;
  await act(async () => {
    answer({ thread });
    await sent;
  });
  expect(connection.store.read().objects.size).toBe(0);
  expect(commentRequest).toHaveBeenCalledTimes(1);
  // Try again after the session ended asks nothing.
  await act(async () => {
    await state.refresh();
  });
  expect(commentRequest).toHaveBeenCalledTimes(1);
  connection.store.destroy();
});

it('a Try again after View only asks nothing', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={vi.fn(() => false)}
      isSessionEnded
    >
      <Probe />
    </CommentProvider>,
  );
  await act(async () => {
    await state.refresh();
  });
  expect(commentRequest).not.toHaveBeenCalled();
  connection.store.destroy();
});
