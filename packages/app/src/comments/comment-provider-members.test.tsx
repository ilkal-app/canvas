// @vitest-environment jsdom
// The board's members, which name sticky authors, never
// outlive a read that failed or was refused: names read for one connection are gone once the
// next connection's read fails.
import { cleanup, render, waitFor } from '@testing-library/react';
import { useContext, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardMembers } from '../service/board-people.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest } from './comment-api.js';
import { commentDataContext } from './comment-data-context.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(commentRequest).mockReset().mockResolvedValue({ threads: [] });
});

/** The members the context holds now; "none" before the context is there. */
let seen: BoardMembers | undefined | 'none' = 'none';

/**
 * Notes the context's board members.
 *
 * @returns Nothing visible.
 */
function Probe(): ReactElement {
  seen = useContext(commentDataContext)?.boardMembers;
  return <span hidden />;
}

const ADA: BoardMembers = {
  members: [
    {
      userId: 'ada',
      name: 'Ada',
      email: 'ada@example.test',
      pictureUrl: null,
      role: 'owner',
      addedAt: '2026-01-01T00:00:00Z',
    },
  ],
  agents: [],
};

it('drops the members once a later read fails or is refused', async () => {
  const client = new FakeMemberDirectory();
  const read = vi
    .spyOn(client, 'listMembers')
    .mockResolvedValueOnce(ADA)
    .mockRejectedValueOnce(new Error('403'));
  const tree = (connection: FakeBoardConnection): ReactElement => (
    <CommentProvider
      connection={connection}
      boardId="board"
      user={FAKE_PERSON}
      client={client}
      onSessionError={() => false}
    >
      <Probe />
    </CommentProvider>
  );
  const view = render(tree(new FakeBoardConnection('board')));
  await waitFor(() => {
    expect(seen).toEqual(ADA);
  });
  view.rerender(tree(new FakeBoardConnection('board')));
  await waitFor(() => {
    expect(read).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(seen).toBeUndefined();
  });
});
