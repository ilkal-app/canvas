// CONTRACT: search resolves a thread's service pin even when no document pin exists.
import { expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_ID } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { CommentData } from '../comments/comment-data-context.js';

import { pinPlaceOf } from './comment-place.js';
import { goToComment } from './use-search-rows.js';

it('places and navigates to a service-pinned thread', async () => {
  const connection = new FakeBoardConnection('board');
  const thread = {
    id: 'thread',
    pinId: 'absent',
    isResolved: false,
    messages: [],
    pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' as const }, point: { x: 80, y: 90 } },
  };
  expect(pinPlaceOf(connection.store.read(), thread)).toEqual({
    pageId: DEFAULT_PAGE_ID,
    point: { x: 80, y: 90 },
  });
  const select = vi.fn();
  const dispatch = vi.fn();
  const comments = { connection, threads: [thread], select } as unknown as CommentData;
  expect(
    await goToComment({ threadId: 'thread', pinId: 'absent' }, comments, {
      pages: undefined,
      dispatch,
    }),
  ).toBe(true);
  expect(dispatch).toHaveBeenCalledWith({
    type: 'frame',
    bounds: { minX: -240, minY: -110, maxX: 400, maxY: 290 },
  });
  expect(select).toHaveBeenCalledWith('thread');
  connection.store.destroy();
});
