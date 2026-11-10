// @vitest-environment jsdom
// A vote's reveal told to a screen reader: a top sticky the service counted that has
// not reached this client's board yet is waited for, across the session's later reads.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createObjectCommand, runCommand } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import { DEFAULT_NOTE_COLOR, newStickyObject } from '@canvas/tools';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { BoardConnection } from '../collab/board-connection.js';
import { ANNOUNCE_DELAY_MS, LiveAnnouncerBoundary } from '../feedback/live-announcer.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { VOTE_ENVIRONMENT, VOTE_ORIGIN, voteBoardStore } from './__fixtures__/vote-board.js';
import { fakeVoteApi, voteSession } from './__fixtures__/vote-session.js';
import { REVEAL_STICKY_WAIT_MS, VoteProvider } from './vote-provider.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A vote revealed with its top sticky, "late", not yet on the board.
 *
 * @returns The region, a way to reveal or read again, and a way to add "late".
 */
function setup() {
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
  const api = fakeVoteApi(voteSession());
  render(
    <LiveAnnouncerBoundary>
      <VoteProvider boardId="board" connection={connection as BoardConnection} api={api}>
        <div />
      </VoteProvider>
    </LiveAnnouncerBoundary>,
  );
  const read = async (): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) listener();
      await Promise.resolve();
    });
  };
  return {
    region: screen.getByRole('status'),
    reveal: async (results = [{ objectId: 'late', count: 2 }]) => {
      api.current = voteSession({ status: 'revealed', results });
      await read();
    },
    read,
    addLate: () => {
      const note = newStickyObject({ x: 0, y: 0 }, DEFAULT_TEXT_STYLE, [...DEFAULT_NOTE_COLOR]);
      const text = 'Late idea';
      act(() => {
        runCommand(
          store,
          VOTE_ORIGIN,
          createObjectCommand,
          { object: { ...note, text, runs: [{ length: text.length, style: DEFAULT_TEXT_STYLE }] } },
          { ...VOTE_ENVIRONMENT, createId: () => 'late' as ObjectId },
        );
      });
    },
  };
}

it('waits for the top sticky to reach the board, across another read of the session', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  await vote.reveal();
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('');
  // The same revealed session read again (a new object) keeps the wait.
  await vote.read();
  vote.addLate();
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Late idea, 2 votes.');
  act(() => {
    vi.advanceTimersByTime(REVEAL_STICKY_WAIT_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Late idea, 2 votes.');
});

it('waits for the service’s leader, not the best sticky already on the board', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  // "inside" ("Ship it") is on the board; the leader, "late", is not yet.
  await vote.reveal([
    { objectId: 'late', count: 3 },
    { objectId: 'inside', count: 1 },
  ]);
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('');
  vote.addLate();
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Late idea, 3 votes.');
});

it('tells the reveal without its top sticky once the wait is over, and whole when it comes', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  await vote.reveal();
  act(() => {
    vi.advanceTimersByTime(REVEAL_STICKY_WAIT_MS + ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in.');
  vote.addLate();
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Late idea, 2 votes.');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the reveal when the leader comes before the preface was read out', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  await vote.reveal();
  act(() => {
    vi.advanceTimersByTime(REVEAL_STICKY_WAIT_MS);
  });
  // The preface is queued, not yet in the region, when the sticky arrives.
  vote.addLate();
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(vote.region.textContent).toBe('Vote results are in. Top sticky: Late idea, 2 votes.');
});

it('stops waiting when the provider unmounts', async () => {
  const vote = setup();
  await act(async () => Promise.resolve());
  await vote.reveal();
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
});
