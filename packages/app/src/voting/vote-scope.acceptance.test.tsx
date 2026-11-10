// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';

import { fakeVoteApi } from './__fixtures__/vote-session.js';
import { voteApiFor } from './vote-api.js';
import { useBoardVote } from './vote-context.js';
import { VoteProvider } from './vote-provider.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('posts scopeId only for a scoped start and preserves the unscoped body', async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      expect(path).toBe('/api/boards/board-1/votes');
      bodies.push(JSON.parse((init?.body as string | undefined) ?? '') as unknown);
      return Promise.resolve(
        new Response(JSON.stringify({ session: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  const api = voteApiFor('board-1');
  await api.start(3);
  await Reflect.apply(api.start, api, [3, 'frame-1']);
  expect(bodies).toEqual([{ votesPerPerson: 3 }, { votesPerPerson: 3, scopeId: 'frame-1' }]);
});

it('passes a scoped start from BoardVote through VoteProvider to VoteApi', async () => {
  const start = vi.fn().mockResolvedValue(null);
  const api = { ...fakeVoteApi(null), start };
  const connection = new FakeBoardConnection('board-1');
  function Probe() {
    const vote = useBoardVote();
    return (
      <button
        type="button"
        onClick={() => {
          if (vote !== undefined) Reflect.apply(vote.start, vote, ['frame-1']);
        }}
      >
        Start in section
      </button>
    );
  }
  render(
    <VoteProvider boardId="board-1" connection={connection as BoardConnection} api={api}>
      <Probe />
    </VoteProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start in section' }));
    await Promise.resolve();
  });
  expect(start).toHaveBeenCalledExactlyOnceWith(3, 'frame-1');
});
