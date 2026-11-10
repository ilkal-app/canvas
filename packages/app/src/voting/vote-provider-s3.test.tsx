// @vitest-environment jsdom
// The board's dot vote in a section: a section-scoped vote, the voting cursor's state,
// the ranked results and the record kept at the end.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { fakeVoteApi, voteSession, type FakeVoteApi } from './__fixtures__/vote-session.js';
import { useBoardVote, type BoardVote } from './vote-context.js';
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
 * A provider over a fake connection on the vote fixture's board, and what its children see.
 *
 * @param api - The routes.
 * @param options - Whether the person is read-only.
 * @param options.isReadOnly - A viewer's or commenter's connection.
 * @returns The connection, its store and the latest vote seen.
 */
function setup(api: FakeVoteApi, options: { readonly isReadOnly?: boolean } = {}) {
  const connection = new FakeBoardConnection('board', undefined, options.isReadOnly === true);
  const { store } = voteBoardStore();
  Object.assign(connection, { store, onVotesChanged: () => () => undefined });
  let seen: BoardVote | undefined;
  function Probe(): null {
    seen = useBoardVote();
    return null;
  }
  render(
    <VoteProvider boardId="board" connection={connection as unknown as BoardConnection} api={api}>
      <Probe />
    </VoteProvider>,
  );
  return {
    store,
    vote: () => {
      if (seen === undefined) throw new Error('No vote.');
      return seen;
    },
  };
}

/**
 * The records of ended votes on a board.
 *
 * @param store - The board's store.
 * @returns Their texts.
 */
function recordsOn(store: ReturnType<typeof voteBoardStore>['store']): string[] {
  return [...store.read().objects.values()].flatMap((object) =>
    object.type === 'sticky' && object.text.startsWith('Vote results') ? [object.text] : [],
  );
}

describe('VoteProvider, section votes and results', () => {
  it('starts a vote in a section and refuses a sticky outside it, saying why', async () => {
    const api = fakeVoteApi(null);
    const f = setup(api);
    await settle();
    api.next = voteSession({ scopeId: 'ideas' });
    act(() => {
      f.vote().start('ideas');
    });
    await settle();
    expect(f.vote().sectionName).toBe('Ideas');
    expect(f.vote().isInScope?.('over')).toBe(true);
    expect(f.vote().isInScope?.('outside')).toBe(false);
    act(() => {
      f.vote().cast('outside');
    });
    expect(f.vote().notice).toBe('Only stickies in Ideas count in this vote');
    api.next = voteSession({ scopeId: 'ideas', myVotes: ['over'], castCount: 1 });
    act(() => {
      f.vote().cast('over');
    });
    await settle();
    expect(f.vote().notice).toBeUndefined();
    expect(api.calls.slice(1)).toEqual(['start:3:ideas', 'cast:session-1:over']);
  });

  it('counts every sticky in a board-wide vote, and names no section', async () => {
    const f = setup(fakeVoteApi(voteSession()));
    await settle();
    expect(f.vote().sectionName).toBeUndefined();
    expect(f.vote().isInScope?.('outside')).toBe(true);
  });

  it('keeps the cursor on only while the person may cast', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api);
    await settle();
    expect(f.vote().isCursorOn).toBe(false);
    act(() => {
      f.vote().setCursorOn?.(true);
    });
    expect(f.vote().isCursorOn).toBe(true);
    api.next = voteSession({ status: 'revealed', results: [] });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(f.vote().isCursorOn).toBe(false);
    const viewer = setup(fakeVoteApi(voteSession()), { isReadOnly: true });
    await settle();
    act(() => {
      viewer.vote().setCursorOn?.(true);
    });
    expect(viewer.vote().isCursorOn).toBe(false);
  });

  it('ranks the revealed results by the board’s stickies', async () => {
    const results = [
      { objectId: 'over', count: 3 },
      { objectId: 'gone', count: 2 },
      { objectId: 'inside', count: 1 },
    ];
    const f = setup(fakeVoteApi(voteSession({ status: 'revealed', results })));
    await settle();
    expect(f.vote().ranked).toEqual([
      { id: 'over', label: 'Fix bugs', count: 3 },
      { id: 'inside', label: 'Ship it', count: 1 },
    ]);
  });

  it('keeps the results on the board once the service ends the vote, and not if it refuses', async () => {
    const results = [{ objectId: 'over', count: 3 }];
    const api = fakeVoteApi(voteSession({ status: 'revealed', results }));
    const f = setup(api);
    await settle();
    api.next = new Error('refused');
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(recordsOn(f.store)).toEqual([]);
    api.next = voteSession({ status: 'ended', results });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(recordsOn(f.store)).toEqual(['Vote results\n1. Fix bugs — 3 votes']);
    expect(f.vote().session).toBeNull();
  });

  it('reveals a hidden vote at End without a record', async () => {
    const api = fakeVoteApi(voteSession());
    const f = setup(api);
    await settle();
    api.next = voteSession({ status: 'revealed', results: [{ objectId: 'over', count: 1 }] });
    act(() => {
      f.vote().finish();
    });
    await settle();
    expect(recordsOn(f.store)).toEqual([]);
    expect(api.calls.at(-1)).toBe('reveal:session-1');
  });
});
