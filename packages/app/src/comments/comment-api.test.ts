import { expect, it, vi } from 'vitest';

import { commentRequest } from './comment-api.js';

const transport = vi.hoisted(() => vi.fn());
vi.mock('../service/api-transport.js', () => ({ createApiTransport: () => transport }));

it('scopes paths, methods and bodies while normalizing empty deletion answers', async () => {
  transport.mockImplementation((request: { read: (value: unknown) => unknown }) =>
    Promise.resolve(request.read(undefined)),
  );
  expect(await commentRequest('a/b', 'DELETE', '/thread/messages/message')).toEqual({});
  expect(transport).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'DELETE',
      path: '/api/boards/a%2Fb/threads/thread/messages/message',
    }),
  );
  const thread = { id: 'thread', pinId: 'pin', messages: [], isResolved: false };
  transport.mockImplementation((request: { read: (value: unknown) => unknown }) =>
    Promise.resolve(request.read({ thread })),
  );
  expect(await commentRequest('board', 'POST', '', { text: 'First' })).toEqual({ thread });
  expect(transport).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: '/api/boards/board/threads', body: { text: 'First' } }),
  );
});
