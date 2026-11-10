// CONTRACT: read marking marks only live sessions, scopes requests to their board, and ignores an old board's in-flight result.
// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { commentRequest, type Thread } from './comment-api.js';
import { useReadMarks } from './comment-read-marks.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(commentRequest).mockReset().mockResolvedValue({}));

const thread: Thread = {
  id: 'same-thread',
  pinId: 'pin',
  isResolved: false,
  lastReadAt: null,
  messages: [
    {
      id: 'message',
      authorId: 'other',
      authorName: 'Other',
      text: 'Unread',
      mentions: [],
      createdAt: '2026-10-21T10:00:00.000Z',
    },
  ],
};

it('sends nothing while the board connection is absent or the session has ended', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(
    ({ isLive }) => {
      useReadMarks({
        boardId: 'board',
        threads: [thread],
        selectedId: thread.id,
        userId: 'me',
        isLive,
        refresh,
      });
    },
    {
      initialProps: { isLive: false },
    },
  );
  expect(commentRequest).not.toHaveBeenCalled();
  view.rerender({ isLive: true });
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledExactlyOnceWith('board', 'POST', '/same-thread/read');
  });
  view.unmount();
});

it('marks the same thread id again on another board and drops the old in-flight refresh', async () => {
  let finishOld!: (answer: { threads?: Thread[] }) => void;
  vi.mocked(commentRequest).mockImplementation((boardId) =>
    boardId === 'first'
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve({}),
  );
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(
    ({ boardId }) => {
      useReadMarks({
        boardId,
        threads: [thread],
        selectedId: thread.id,
        userId: 'me',
        isLive: true,
        refresh,
      });
    },
    {
      initialProps: { boardId: 'first' },
    },
  );
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith('first', 'POST', '/same-thread/read');
  });
  view.rerender({ boardId: 'second' });
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith('second', 'POST', '/same-thread/read');
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  finishOld({});
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  view.unmount();
});
