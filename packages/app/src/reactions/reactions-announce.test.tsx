// @vitest-environment jsdom
// The provider's reaction announcements: after a quiet interval the throttle stops its
// timer, and the next reaction is told at once again.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { ReactionEvent } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { ANNOUNCE_DELAY_MS, LiveAnnouncerBoundary } from '../feedback/live-announcer.js';

import { REACTION_ANNOUNCE_INTERVAL_MS } from './reaction-announcements.js';
import { ReactionsProvider } from './reactions-provider.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The provider in a live region over a fake reactions channel.
 *
 * @returns The region and a way to hear someone else's reaction.
 */
function setup() {
  const listeners = new Set<(event: ReactionEvent) => void>();
  const connection = new FakeBoardConnection('board');
  Object.assign(connection, {
    reactions: {
      send: () => true,
      subscribe: (listener: (event: ReactionEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const hear = (emoji: ReactionEvent['emoji']): void => {
    act(() => {
      for (const listener of listeners) listener({ emoji, x: 0, y: 0, pageId: 'p', from: 'u:b' });
    });
  };
  render(
    <LiveAnnouncerBoundary>
      <ReactionsProvider connection={connection}>{null}</ReactionsProvider>
    </LiveAnnouncerBoundary>,
  );
  return { region: screen.getByRole('status'), hear };
}

it('goes quiet after an interval with nothing gathered, then tells the next reaction at once', () => {
  vi.useFakeTimers();
  const { region, hear } = setup();
  hear('👀');
  act(() => {
    vi.advanceTimersByTime(REACTION_ANNOUNCE_INTERVAL_MS + ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with eyes');
  expect(vi.getTimerCount()).toBe(0);
  hear('🤔');
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with thinking face');
});

it('tells a burst within five seconds even when the timer was held back (a suspended tab)', () => {
  vi.useFakeTimers();
  const { region, hear } = setup();
  hear('👍');
  hear('❤️');
  // The clock jumps a minute while the interval's timer has not run.
  vi.setSystemTime(Date.now() + 60_000);
  hear('🎉');
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with heart');
  act(() => {
    vi.advanceTimersByTime(REACTION_ANNOUNCE_INTERVAL_MS + ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with party popper');
});
