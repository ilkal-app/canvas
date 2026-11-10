// @vitest-environment jsdom
// The board's dot vote for the shell: read, read again on notices and reconnects, and
// the owner's and editors' actions on it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { ApiError } from '../service/api-error.js';

import { fakeVoteApi, voteSession, type FakeVoteApi } from './__fixtures__/vote-session.js';
import { shownVotesOf, useBoardVote, votesLeftIn, type BoardVote } from './vote-context.js';
import { VoteProvider } from './vote-provider.js';

afterEach(cleanup);

/** Flushes the pending answers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * A provider over a fake connection and routes, and what its children see.
 *
 * @param api - The routes.
 * @param options - Whether the person is read-only, and whether their session ended.
 * @param options.isReadOnly - A viewer's or commenter's connection.
 * @param options.isSessionEnded - Their session ended.
 * @returns The connection, the latest vote seen, and a trigger of the votes-changed notice.
 */
function setup(
  api: FakeVoteApi,
  options: { readonly isReadOnly?: boolean; readonly isSessionEnded?: boolean } = {},
) {
  const connection = new FakeBoardConnection('board', undefined, options.isReadOnly === true);
  let notice: (() => void) | undefined;
  const stop = vi.fn();
  Object.assign(connection, {
    onVotesChanged: (listener: () => void) => {
      notice = listener;
      return stop;
    },
  });
  let seen: BoardVote | undefined;
  function Probe(): null {
    seen = useBoardVote();
    return null;
  }
  const view = render(
    <VoteProvider
      boardId="board"
      connection={connection as unknown as BoardConnection}
      api={api}
      isSessionEnded={options.isSessionEnded}
    >
      <Probe />
    </VoteProvider>,
  );
  return {
    connection,
    view,
    stop,
    vote: () => {
      if (seen === undefined) throw new Error('No vote.');
      return seen;
    },
    notice: () => notice?.(),
  };
}

describe('VoteProvider', () => {
  it('reads the vote, again on the notice and after a reconnect, and stops on unmount', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api);
    await settle();
    expect(f.vote().session?.id).toBe('session-1');
    expect(f.vote().canVote).toBe(true);
    api.current = voteSession({ castCount: 2 });
    act(() => {
      f.notice();
    });
    await settle();
    expect(f.vote().session?.castCount).toBe(2);
    act(() => {
      f.connection.setState('reconnecting');
    });
    api.current = null;
    act(() => {
      f.connection.setState('connected');
    });
    await settle();
    expect(f.vote().session).toBeNull();
    expect(api.calls).toEqual(['read', 'read', 'read']);
    f.view.unmount();
    expect(f.stop).toHaveBeenCalled();
  });

  it('starts, casts, takes back and finishes through the routes, showing each answer', async () => {
    const api = fakeVoteApi(null);
    const f = setup(api);
    await settle();
    api.next = voteSession();
    act(() => {
      f.vote().start();
    });
    await settle();
    expect(f.vote().session?.status).toBe('open');
    api.next = voteSession({ myVotes: ['note'], castCount: 1 });
    act(() => {
      f.vote().cast('note');
    });
    await settle();
    expect(f.vote().session?.myVotes).toEqual(['note']);
    api.next = voteSession();
    act(() => {
      f.vote().retract('note');
    });
    await settle();
    // A hidden open vote reveals first; a revealed one ends, and an ended one is no vote.
    api.next = voteSession({ status: 'revealed', results: [] });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(f.vote().session?.status).toBe('revealed');
    api.next = voteSession({ status: 'ended', results: [] });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(f.vote().session).toBeNull();
    expect(api.calls.slice(1)).toEqual([
      'start:3',
      'cast:session-1:note',
      'retract:session-1:note',
      'reveal:session-1',
      'end:session-1',
    ]);
  });

  it('ends a vote shown all along at once, and does nothing without a session', async () => {
    const api = fakeVoteApi(null);
    const f = setup(api);
    await settle();
    act(() => {
      f.vote().cast('note');
      f.vote().retract('note');
      f.vote().finish();
    });
    expect(api.calls).toEqual(['read']);
    api.current = voteSession({ isHidden: false, results: [] });
    act(() => {
      f.notice();
    });
    await settle();
    api.next = voteSession({ status: 'ended', isHidden: false, results: [] });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(api.calls.at(-1)).toBe('end:session-1');
  });

  it('says why a refused action failed, and reads the vote again', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api);
    await settle();
    const refusals: [Error, string][] = [
      [new ApiError('vote-limit'), 'You have used all your votes'],
      [new ApiError('vote-forbidden'), 'Only the owner and editors vote'],
      [new ApiError('vote-open'), 'The vote changed. It is shown as it is now.'],
      [new ApiError('vote-closed'), 'The vote changed. It is shown as it is now.'],
      [new ApiError('unavailable'), 'The vote could not be updated. Try again.'],
    ];
    for (const [error, words] of refusals) {
      api.next = error;
      act(() => {
        f.vote().cast('note');
      });
      await settle();
      expect(f.vote().notice).toBe(words);
    }
    expect(api.calls.filter((call) => call === 'read')).toHaveLength(1 + refusals.length);
  });

  it('keeps what it showed when a read fails', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api);
    await settle();
    api.read = () => Promise.reject(new Error('offline'));
    act(() => {
      f.notice();
    });
    await settle();
    expect(f.vote().session?.id).toBe('session-1');
  });

  it('lets a viewer or commenter see the vote but not act on it', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api, { isReadOnly: true });
    await settle();
    expect(f.vote().canVote).toBe(false);
    expect(f.vote().session?.id).toBe('session-1');
    act(() => {
      f.vote().start();
    });
    expect(api.calls).toEqual(['read']);
  });

  it('drops an action’s outcome that comes after the session ended, and reads nothing more', async () => {
    const api = fakeVoteApi(voteSession());
    const connection = new FakeBoardConnection('board');
    let seen: BoardVote | undefined;
    function Probe(): null {
      seen = useBoardVote();
      return null;
    }
    const tree = (isSessionEnded: boolean) => (
      <VoteProvider
        boardId="board"
        connection={connection}
        api={api}
        isSessionEnded={isSessionEnded}
      >
        <Probe />
      </VoteProvider>
    );
    const view = render(tree(false));
    await settle();
    const outcomes: { resolve: (session: null) => void; reject: (error: Error) => void }[] = [];
    api.cast = () =>
      new Promise((resolve, reject) => {
        outcomes.push({ resolve, reject });
      });
    act(() => {
      seen?.cast('a');
      seen?.cast('b');
    });
    view.rerender(tree(true));
    const [failed, answered] = outcomes;
    await act(async () => {
      failed?.reject(new ApiError('vote-limit'));
      answered?.resolve(null);
      await Promise.resolve();
    });
    expect(seen?.notice).toBeUndefined();
    expect(seen?.session?.id).toBe('session-1');
    expect(api.calls).toEqual(['read']);
  });

  it('asks nothing once the person’s session ended', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api, { isSessionEnded: true });
    await settle();
    expect(api.calls).toEqual([]);
    expect(f.vote().canVote).toBe(false);
  });
});

describe('the vote helpers', () => {
  it('counts the person’s votes left, never below zero', () => {
    expect(votesLeftIn(voteSession({ myVotes: ['a'] }))).toBe(2);
    expect(votesLeftIn(voteSession({ votesPerPerson: 1, myVotes: ['a', 'b'] }))).toBe(0);
  });

  it('shows the person’s own votes while hidden, and everyone’s once seen', () => {
    expect([...shownVotesOf(voteSession({ myVotes: ['a', 'b', 'a'] }))]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect([
      ...shownVotesOf(
        voteSession({
          status: 'revealed',
          myVotes: ['a'],
          results: [
            { objectId: 'b', count: 4 },
            { objectId: 'a', count: 1 },
          ],
        }),
      ),
    ]).toEqual([
      ['b', 4],
      ['a', 1],
    ]);
  });
});
