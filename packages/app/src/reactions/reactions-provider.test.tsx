// @vitest-environment jsdom
// The board's reactions for the shell: everyone else's from the channel, the person's
// own sent and shown, "+1", the roles, and how long and how many show.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactionDrop, ReactionEvent } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { commentContext, type CommentMode } from '../comments/comment-context.js';

import {
  MAX_SHOWN_REACTIONS,
  REACTION_LIFETIME_MS,
  REPEAT_OFFSET,
  useBoardReactions,
  type BoardReactions,
} from './reactions-context.js';
import { ReactionsProvider } from './reactions-provider.js';

afterEach(cleanup);

/**
 * A fake reactions channel: what was sent, and a way to hear someone else's.
 *
 * @returns The channel.
 */
function fakeChannel() {
  const sent: ReactionDrop[] = [];
  const listeners = new Set<(event: ReactionEvent) => void>();
  return {
    sent,
    send: vi.fn((drop: ReactionDrop) => {
      if (drop.x > 1e9) throw new RangeError('Off the board.');
      sent.push(drop);
      return true;
    }),
    subscribe: (listener: (event: ReactionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hear: (event: ReactionEvent) => {
      for (const listener of listeners) listener(event);
    },
    listeners,
  };
}

/**
 * The provider over a fake connection, with a manual clock for removals.
 *
 * @param options - Whether the person is read-only and may write comments, and whether the
 *   connection has reactions.
 * @param options.isReadOnly - A viewer's or a commenter's connection.
 * @param options.canWriteComments - A commenter (with `isReadOnly`).
 * @param options.hasChannel - The connection has reactions; true if absent.
 * @returns The channel, the latest reactions seen, the pending removals and the view.
 */
function setup(
  options: {
    readonly isReadOnly?: boolean;
    readonly canWriteComments?: boolean;
    readonly hasChannel?: boolean;
  } = {},
) {
  const connection = new FakeBoardConnection('board', undefined, options.isReadOnly === true);
  const channel = fakeChannel();
  if (options.hasChannel !== false) Object.assign(connection, { reactions: channel });
  const removals: { run: () => void; ms: number; isCancelled: boolean }[] = [];
  const schedule = (run: () => void, ms: number) => {
    const removal = { run, ms, isCancelled: false };
    removals.push(removal);
    return () => {
      removal.isCancelled = true;
    };
  };
  let seen: BoardReactions | undefined;
  function Probe(): null {
    seen = useBoardReactions();
    return null;
  }
  const mode = { canWrite: options.canWriteComments === true } as unknown as CommentMode;
  const view = render(
    <commentContext.Provider value={mode}>
      <ReactionsProvider connection={connection} schedule={schedule}>
        <Probe />
      </ReactionsProvider>
    </commentContext.Provider>,
  );
  return {
    channel,
    removals,
    view,
    reactions: () => {
      if (seen === undefined) throw new Error('No reactions.');
      return seen;
    },
  };
}

const PLACE = { x: 100, y: 200, pageId: 'page-1' };

describe('ReactionsProvider', () => {
  it('shows everyone else’s reactions, the last of them for "+1", and removes each in time', () => {
    const f = setup();
    act(() => {
      f.channel.hear({ emoji: '🎉', ...PLACE, from: 'user:b' });
    });
    expect(f.reactions().shown).toEqual([{ id: 1, emoji: '🎉', ...PLACE, isOwn: false }]);
    expect(f.reactions().last).toEqual({ emoji: '🎉', ...PLACE });
    expect(f.removals[0]?.ms).toBe(REACTION_LIFETIME_MS);
    act(() => {
      f.removals[0]?.run();
    });
    expect(f.reactions().shown).toEqual([]);
  });

  it('drops the armed emoji: sent once and shown at once, the relay not echoing it', () => {
    const f = setup();
    act(() => {
      f.reactions().drop(PLACE);
    });
    expect(f.channel.sent).toEqual([]);
    act(() => {
      f.reactions().arm('👍');
    });
    expect(f.reactions().armed).toBe('👍');
    act(() => {
      f.reactions().drop(PLACE);
    });
    expect(f.channel.sent).toEqual([{ emoji: '👍', ...PLACE }]);
    expect(f.reactions().shown.map((item) => [item.emoji, item.isOwn])).toEqual([['👍', true]]);
  });

  it('sends at the view’s centre once the board layer gives it, and nothing before', () => {
    const f = setup();
    act(() => {
      f.reactions().sendAtCentre('👀');
    });
    expect(f.channel.sent).toEqual([]);
    act(() => {
      f.reactions().provideCentre(() => PLACE);
    });
    act(() => {
      f.reactions().sendAtCentre('👀');
    });
    expect(f.channel.sent).toEqual([{ emoji: '👀', ...PLACE }]);
    act(() => {
      f.reactions().provideCentre(undefined);
      f.reactions().sendAtCentre('👀');
    });
    expect(f.channel.sent).toHaveLength(1);
  });

  it('repeats the last reaction beside it with "+1", and does nothing before the first', () => {
    const f = setup();
    act(() => {
      f.reactions().repeat();
    });
    expect(f.channel.sent).toEqual([]);
    act(() => {
      f.channel.hear({ emoji: '😂', ...PLACE, from: 'user:b' });
    });
    act(() => {
      f.reactions().repeat();
    });
    expect(f.channel.sent).toEqual([
      { emoji: '😂', x: PLACE.x + REPEAT_OFFSET, y: PLACE.y - REPEAT_OFFSET, pageId: 'page-1' },
    ]);
  });

  it('shows nothing the wire refuses (off the board)', () => {
    const f = setup();
    act(() => {
      f.reactions().arm('👀');
    });
    act(() => {
      f.reactions().drop({ ...PLACE, x: 2e9 });
    });
    expect(f.reactions().shown).toEqual([]);
  });

  it('keeps the newest reactions when too many show at once', () => {
    const f = setup();
    act(() => {
      for (let index = 0; index < MAX_SHOWN_REACTIONS + 5; index++) {
        f.channel.hear({ emoji: '❤️', ...PLACE, from: 'user:b' });
      }
    });
    const ids = f.reactions().shown.map((item) => item.id);
    expect(ids).toHaveLength(MAX_SHOWN_REACTIONS);
    expect(ids[0]).toBe(6);
  });

  it('opens and closes the flyout, which disarms', () => {
    const f = setup();
    act(() => {
      f.reactions().toggle();
      f.reactions().arm('🙌');
    });
    expect([f.reactions().isOpen, f.reactions().armed]).toEqual([true, '🙌']);
    act(() => {
      f.reactions().close();
    });
    expect([f.reactions().isOpen, f.reactions().armed]).toEqual([false, null]);
    act(() => {
      f.reactions().toggle();
    });
    act(() => {
      f.reactions().toggle();
    });
    expect(f.reactions().isOpen).toBe(false);
  });

  it('lets a commenter react, and a viewer only see reactions', () => {
    const commenter = setup({ isReadOnly: true, canWriteComments: true });
    expect(commenter.reactions().canReact).toBe(true);
    cleanup();
    const viewer = setup({ isReadOnly: true });
    expect(viewer.reactions().canReact).toBe(false);
    act(() => {
      viewer.reactions().toggle();
      viewer.reactions().arm('👍');
    });
    expect([viewer.reactions().isOpen, viewer.reactions().armed]).toEqual([false, null]);
    act(() => {
      viewer.reactions().drop(PLACE);
      viewer.channel.hear({ emoji: '🤔', ...PLACE, from: 'user:b' });
    });
    expect(viewer.channel.sent).toEqual([]);
    expect(viewer.reactions().shown).toHaveLength(1);
  });

  it('reacts with nothing on a board without reactions, and stops listening and its timers on unmount', () => {
    const none = setup({ hasChannel: false });
    expect(none.reactions().canReact).toBe(false);
    cleanup();
    const f = setup();
    act(() => {
      f.channel.hear({ emoji: '🎉', ...PLACE, from: 'user:b' });
    });
    f.view.unmount();
    expect(f.channel.listeners.size).toBe(0);
    expect(f.removals[0]?.isCancelled).toBe(true);
  });
});
