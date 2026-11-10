// CONTRACT: placing a comment creates a service pin without a document comment or undo entry, for editors and commenters.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId, type PageId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread } from './comment-api.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(commentRequest).mockReset().mockResolvedValue({ threads: [] }));
let data: CommentData;
function Probe() {
  const current = useContext(commentDataContext);
  if (current) data = current;
  return null;
}
const thread: Thread = {
  id: 'thread',
  pinId: 'pin',
  isResolved: false,
  messages: [],
  pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point: { x: 30, y: 40 } },
};

it.each([
  ['editor', false, false],
  ['commenter', true, true],
] as const)(
  '%s sends the placement pin with first-page fallback and leaves document undo untouched',
  async (role, isReadOnly, canComment) => {
    expect(canComment).toBe(role === 'commenter');
    const connection = new FakeBoardConnection('board', undefined, isReadOnly);
    const history = createHistory(connection.store, connection.origin.principalId);
    const client = new FakeMemberDirectory();
    vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
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
    await waitFor(() => {
      expect(commentRequest).toHaveBeenCalledWith('board', 'GET');
    });
    vi.mocked(commentRequest).mockImplementation((...[, method]) =>
      Promise.resolve(method === 'GET' ? { threads: [thread] } : { thread }),
    );
    const before = connection.store.encodeState();
    act(() => {
      data.place({ id: 'pin' as ObjectId, point: { x: 30, y: 40 }, anchor: { kind: 'point' } });
    });
    render(<CommentDialog data={data} canWrite />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'First' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(commentRequest).toHaveBeenCalledWith(
        'board',
        'POST',
        '',
        expect.objectContaining({
          text: 'First',
          pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point: { x: 30, y: 40 } },
        }),
      );
    });
    expect(
      [...connection.store.read().objects.values()].filter((object) => object.type === 'comment'),
    ).toEqual([]);
    expect(connection.store.encodeState()).toEqual(before);
    history.undo();
    expect(connection.store.encodeState()).toEqual(before);
    history.destroy();
    view.unmount();
    connection.store.destroy();
  },
);

it('sends an explicit placement page and object anchor unchanged', async () => {
  const connection = new FakeBoardConnection('board');
  const client = new FakeMemberDirectory();
  vi.spyOn(client, 'listMembers').mockResolvedValue({ members: [], agents: [] });
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
    expect(commentRequest).toHaveBeenCalledWith('board', 'GET');
  });
  vi.mocked(commentRequest).mockImplementation((...[, method]) =>
    Promise.resolve(method === 'GET' ? { threads: [] } : { thread }),
  );
  const pin = {
    pageId: 'page-other' as PageId,
    anchor: { kind: 'object' as const, objectId: 'sticky' as ObjectId, offset: { x: 3, y: 4 } },
    point: { x: 30, y: 40 },
  };
  act(() => {
    data.place({ id: 'pin' as ObjectId, ...pin });
  });
  render(<CommentDialog data={data} canWrite />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'First' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => {
    expect(commentRequest).toHaveBeenCalledWith(
      'board',
      'POST',
      '',
      expect.objectContaining({ text: 'First', pin }),
    );
  });
  view.unmount();
  connection.store.destroy();
});
