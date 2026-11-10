// @vitest-environment jsdom
// CONTRACT: a scoped vote never sends an out-of-section cast, and revealing a
// hidden vote cannot create a results sticky before the session is closed.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { fakeVoteApi, voteSession } from './__fixtures__/vote-session.js';
import { useBoardVote, type BoardVote } from './vote-context.js';
import { VoteProvider } from './vote-provider.js';

afterEach(cleanup);

it('refuses an outside cast without a request and creates no record on reveal', async () => {
  const { store } = voteBoardStore();
  const connection = new FakeBoardConnection('board');
  Object.assign(connection, { store, onVotesChanged: () => () => undefined });
  const api = fakeVoteApi(voteSession({ scopeId: 'ideas' }));
  let vote: BoardVote | undefined;
  function Probe(): null {
    vote = useBoardVote();
    return null;
  }
  render(
    <VoteProvider boardId="board" connection={connection as BoardConnection} api={api}>
      <Probe />
    </VoteProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  if (vote === undefined) throw new Error('No vote');
  const current = vote;
  const before = [...api.calls];
  act(() => {
    current.cast('outside');
  });
  expect(api.calls).toEqual(before);
  expect(vote.notice).toBe('Only stickies in Ideas count in this vote');
  api.next = voteSession({
    scopeId: 'ideas',
    status: 'revealed',
    results: [{ objectId: 'inside', count: 1 }],
  });
  act(() => {
    vote?.finish();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.calls.at(-1)).toBe('reveal:session-1');
  expect(
    [...store.read().objects.values()].filter(
      (object) => object.type === 'sticky' && object.text.startsWith('Vote results'),
    ),
  ).toHaveLength(0);
});
