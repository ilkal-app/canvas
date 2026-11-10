// CONTRACT: opening one unread state sends one mark while that request is pending.
// A rerender or a duplicate notification cannot send another mark before the first finishes.
// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentRequest, type Thread } from './comment-api.js';
import { useReadMarks } from './comment-read-marks.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);

it('keeps one in-flight mark for repeated renders of the same unread state', async () => {
  let finish: (() => void) | undefined;
  vi.mocked(commentRequest)
    .mockReset()
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({});
          };
        }),
    );
  const thread: Thread = {
    id: 'thread',
    pinId: 'pin',
    isResolved: false,
    lastReadAt: null,
    messages: [
      {
        id: 'message',
        authorId: 'other',
        authorName: 'Other',
        text: 'Hello',
        mentions: [],
        createdAt: '2026-10-21T12:00:00.000Z',
      },
    ],
  };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const input = {
    boardId: 'board',
    selectedId: 'thread',
    userId: 'me',
    refresh,
    threads: [thread],
  };
  const view = renderHook(
    (props: typeof input) => {
      useReadMarks(props);
    },
    { initialProps: input },
  );
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledTimes(1);
  });
  view.rerender({ ...input, threads: [{ ...thread }] });
  view.rerender({ ...input, threads: [{ ...thread }] });
  expect(commentRequest).toHaveBeenCalledTimes(1);
  finish?.();
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  expect(commentRequest).toHaveBeenCalledTimes(1);
});
