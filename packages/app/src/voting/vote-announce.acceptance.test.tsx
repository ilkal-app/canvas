// CONTRACT: an open vote revealed in-session announces its top sticky; initial revealed reads stay silent.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { LiveAnnouncerBoundary } from '../feedback/live-announcer.js';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { fakeVoteApi, voteSession } from './__fixtures__/vote-session.js';
import { voteRevealAnnouncementOf } from './vote-announcement.js';
import { VoteProvider } from './vote-provider.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('formats the first ranked sticky and singular or plural votes', () => {
  expect(voteRevealAnnouncementOf([])).toBe('Vote results are in.');
  expect(voteRevealAnnouncementOf([{ id: 'a', label: 'Ship it', count: 1 }])).toBe(
    'Vote results are in. Top sticky: Ship it, 1 vote.',
  );
  expect(
    voteRevealAnnouncementOf([
      { id: 'a', label: 'Fix bugs', count: 2 },
      { id: 'b', label: 'Ship it', count: 1 },
    ]),
  ).toBe('Vote results are in. Top sticky: Fix bugs, 2 votes.');
});

/**
 * Renders a vote with the board fixture and a fake votes-changed notice.
 *
 * @param isInitiallyRevealed - Whether the first read is already revealed.
 * @returns The fake API, region and a way to send a votes-changed notice.
 */
function setup(isInitiallyRevealed = false) {
  vi.useFakeTimers();
  const { store } = voteBoardStore();
  const connection = new FakeBoardConnection('board');
  const listeners = new Set<() => void>();
  Object.assign(connection, {
    store,
    onVotesChanged: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const revealed = voteSession({
    status: 'revealed',
    results: [{ objectId: 'inside', count: 1 }],
  });
  const api = fakeVoteApi(isInitiallyRevealed ? revealed : voteSession());
  render(
    <LiveAnnouncerBoundary>
      <VoteProvider boardId="board" connection={connection as BoardConnection} api={api}>
        <div />
      </VoteProvider>
    </LiveAnnouncerBoundary>,
  );
  return {
    api,
    revealed,
    region: screen.getByRole('status'),
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
}

it('announces the top sticky when a previously open vote becomes revealed', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  vote.api.current = vote.revealed;
  await act(async () => {
    vote.notify();
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Ship it, 1 vote.');
});

it('does not announce a vote already revealed on the first read', async () => {
  const vote = setup(true);
  await act(async () => Promise.resolve());
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(vote.region.textContent).toBe('');
});

it('announces only the results preface when a revealed vote has no ranked sticky', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  vote.api.current = voteSession({ status: 'revealed', results: [] });
  await act(async () => {
    vote.notify();
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(vote.region.textContent).toBe('Vote results are in.');
});
