// CONTRACT: remote reactions announce once immediately and once per burst; own drops stay silent.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { ReactionEvent } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { LiveAnnouncerBoundary } from '../feedback/live-announcer.js';

import { boardReactions } from './__fixtures__/board-reactions.js';
import { useBoardReactions, type BoardReactions } from './reactions-context.js';
import { ReactionsProvider } from './reactions-provider.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A local channel with the same send and subscribe surface as a board connection.
 *
 * @returns The channel and a way to hear an incoming reaction.
 */
function fakeChannel() {
  const listeners = new Set<(event: ReactionEvent) => void>();
  return {
    send: vi.fn(() => true),
    subscribe: (listener: (event: ReactionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hear: (event: ReactionEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

it('announces ten remote reactions as one immediate and one nine-reaction summary', () => {
  vi.useFakeTimers();
  const channel = fakeChannel();
  const connection = new FakeBoardConnection('board');
  Object.assign(connection, { reactions: channel });
  let reactions: BoardReactions = boardReactions();
  function Probe(): null {
    reactions = useBoardReactions() ?? reactions;
    return null;
  }
  render(
    <LiveAnnouncerBoundary>
      <ReactionsProvider connection={connection}>
        <Probe />
      </ReactionsProvider>
    </LiveAnnouncerBoundary>,
  );
  const region = screen.getByRole('status');
  const place = { x: 100, y: 200, pageId: 'page-1' };
  act(() => {
    channel.hear({ emoji: '👍', ...place, from: 'user:other' });
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(region.textContent).toBe('Someone reacted with thumbs up');
  act(() => {
    for (let index = 0; index < 9; index++)
      channel.hear({ emoji: '❤️', ...place, from: 'user:other' });
  });
  expect(region.textContent).toBe('Someone reacted with thumbs up');
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(region.textContent).toBe('9 reactions: heart');
  act(() => {
    reactions.arm('🎉');
  });
  act(() => {
    reactions.drop(place);
  });
  expect(channel.send).toHaveBeenCalledOnce();
  act(() => {
    vi.advanceTimersByTime(50);
  });
  expect(region.textContent).toBe('9 reactions: heart');
});
