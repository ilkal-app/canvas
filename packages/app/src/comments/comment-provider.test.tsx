// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('loads, refetches on notices and reconnect, and unregisters on close', async () => {
  const f = setup();
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith('board', 'GET');
  });
  vi.mocked(commentRequest).mockResolvedValue({ threads: [thread] });
  act(() => {
    f.notice();
  });
  await screen.findByText('thread');
  const count = vi.mocked(commentRequest).mock.calls.length;
  act(() => {
    f.connection.setState('reconnecting');
    f.connection.setState('connected');
  });
  await waitFor(() => {
    expect(vi.mocked(commentRequest).mock.calls.length).toBe(count + 1);
  });
  f.view.unmount();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  f.connection.store.destroy();
});

it('writes, refreshes, navigates and creates the thread with its pin in the service', async () => {
  const f = setup();
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
  expect(screen.getByText('true:false')).toBeDefined();
  act(() => {
    state.place(commentPlacement(f.connection.store.read(), { x: 10, y: 20 }));
  });
  vi.mocked(commentRequest).mockImplementation((...[, method]) =>
    Promise.resolve(method === 'GET' ? { threads: [thread] } : { thread }),
  );
  await act(async () => {
    await state.change('', { text: 'First' });
  });
  expect(state.selectedId).toBe('thread');
  expect(state.placement).toBeUndefined();
  // The pin went to the service with the thread: the document has no comment object.
  expect(f.connection.store.read().objects.size).toBe(0);
  act(() => {
    state.select('thread');
    state.close();
  });
  expect(state.selectedId).toBeUndefined();
  expect(state.placement).toBeUndefined();
  f.connection.store.destroy();
});

it('refuses viewer writes and retains a recoverable error after a failed editor write', async () => {
  const viewer = setup(true);
  await waitFor(() => {
    expect(viewer.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockClear();
  await act(async () => {
    await state.change('', { text: 'No' });
  });
  expect(commentRequest).not.toHaveBeenCalled();
  viewer.view.unmount();
  viewer.connection.store.destroy();
  const editor = setup();
  await waitFor(() => {
    expect(editor.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockRejectedValue(new Error('offline'));
  await act(async () => {
    await expect(state.change('', { text: 'Keep' })).rejects.toThrow('offline');
  });
  expect(state.isBusy).toBe(false);
  expect(state.error).toContain('could not be saved');
  editor.connection.store.destroy();
});

it('lets a commenter write comments on a read-only connection', async () => {
  const commenter = setup(
    true,
    vi.fn(() => false),
    true,
  );
  await waitFor(() => {
    expect(commenter.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockClear().mockResolvedValue({ threads: [] });
  await act(async () => {
    await state.change('', { text: 'Yes' });
  });
  expect(commentRequest).toHaveBeenCalled();
  commenter.connection.store.destroy();
});

it('routes session errors and drops an obsolete load after unmount', async () => {
  let resolve!: (value: { threads: Thread[] }) => void;
  vi.mocked(commentRequest).mockImplementationOnce(
    () =>
      new Promise((accept) => {
        resolve = accept;
      }),
  );
  const f = setup();
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  f.view.unmount();
  await act(async () => {
    resolve({ threads: [thread] });
    await Promise.resolve();
  });
  expect(state.threads).toEqual([]);
  f.connection.store.destroy();
  vi.mocked(commentRequest).mockRejectedValue(new Error('session ended'));
  const expired = setup(
    false,
    vi.fn(() => true),
  );
  await waitFor(() => {
    expect(expired.onSessionError).toHaveBeenCalled();
  });
  expect(state.error).toBe('');
  expired.connection.store.destroy();
});

it('keeps the preview canvas mounted and comments dormant until the connection opens', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  const members = vi.spyOn(client, 'listMembers');
  const onSessionError = vi.fn(() => false);
  const shell = (live: FakeBoardConnection | undefined) => (
    <CommentProvider
      connection={live}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={onSessionError}
    >
      <canvas aria-label="Preview canvas" />
    </CommentProvider>
  );
  const view = render(shell(undefined));
  const canvas = screen.getByLabelText('Preview canvas');
  expect(commentRequest).not.toHaveBeenCalled();
  expect(members).not.toHaveBeenCalled();
  view.rerender(shell(connection));
  await waitFor(() => {
    expect(members).toHaveBeenCalledOnce();
  });
  expect(screen.getByLabelText('Preview canvas')).toBe(canvas);
  expect(commentRequest).toHaveBeenCalledWith('board', 'GET');
  view.unmount();
  connection.store.destroy();
});

it('ignores a failed thread load after the board closes', async () => {
  let rejectLoad: (error: Error) => void = () => undefined;
  vi.mocked(commentRequest).mockImplementationOnce(
    () =>
      new Promise((accept, reject) => {
        rejectLoad = reject;
      }),
  );
  const f = setup();
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  f.view.unmount();
  await act(async () => {
    rejectLoad(new Error('late board load failure'));
    await Promise.resolve();
  });
  expect(f.onSessionError).not.toHaveBeenCalled();
  expect(state.error).toBe('');
  f.connection.store.destroy();
});

it('ignores an obsolete load failure after a newer refresh succeeds', async () => {
  let rejectLoad: (error: Error) => void = () => undefined;
  vi.mocked(commentRequest).mockImplementationOnce(
    () =>
      new Promise((accept, reject) => {
        rejectLoad = reject;
      }),
  );
  const f = setup();
  await waitFor(() => {
    expect(f.members).toHaveBeenCalled();
  });
  vi.mocked(commentRequest).mockResolvedValueOnce({ threads: [thread] });
  act(() => f.notice());
  await screen.findByText('thread');
  await act(async () => {
    rejectLoad(new Error('older request failure'));
    await Promise.resolve();
  });
  expect(f.onSessionError).not.toHaveBeenCalled();
  expect(state.error).toBe('');
  f.view.unmount();
  f.connection.store.destroy();
});

it('ignores a failed member lookup after the board closes', async () => {
  let rejectMembers: (error: Error) => void = () => undefined;
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockImplementationOnce(
    () =>
      new Promise((accept, reject) => {
        rejectMembers = reject;
      }),
  );
  const onSessionError = vi.fn(() => false);
  const view = render(
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={onSessionError}
    >
      <Probe />
    </CommentProvider>,
  );
  view.unmount();
  await act(async () => {
    rejectMembers(new Error('late member lookup failure'));
    await Promise.resolve();
  });
  expect(onSessionError).not.toHaveBeenCalled();
  connection.store.destroy();
});
