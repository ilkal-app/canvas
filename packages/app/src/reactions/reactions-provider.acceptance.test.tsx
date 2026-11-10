// @vitest-environment jsdom
// CONTRACT: viewers observe but never send; repeats, bounds, capacity and lifetime are enforced at the board boundary.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactionDrop, ReactionEvent } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { useCommentKeyDispatch } from '../shell/use-comment-key-dispatch.js';
import type { ShellAction } from '../state/shell-action.js';

import {
  MAX_SHOWN_REACTIONS,
  REACTION_LIFETIME_MS,
  useBoardReactions,
  type BoardReactions,
} from './reactions-context.js';
import { ReactionsProvider } from './reactions-provider.js';

const PLACE = { x: 100, y: 200, pageId: 'page-1' };

afterEach(cleanup);

function setup(isViewer = false) {
  const connection = new FakeBoardConnection('board', undefined, isViewer);
  const listeners = new Set<(event: ReactionEvent) => void>();
  const sent: ReactionDrop[] = [];
  const send = vi.fn((drop: ReactionDrop) => {
    if (drop.x > 1e9) throw new RangeError('Outside board bounds');
    sent.push(drop);
    return true;
  });
  Object.assign(connection, {
    reactions: {
      send,
      subscribe: (listener: (event: ReactionEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  const timers: { run: () => void; ms: number }[] = [];
  let reactions: BoardReactions | undefined;
  let choose: ((action: ShellAction) => void) | undefined;
  function Probe(): null {
    reactions = useBoardReactions();
    choose = useCommentKeyDispatch(vi.fn(), { canEdit: !isViewer, activeTool: 'select' });
    return null;
  }
  render(
    <commentContext.Provider value={{ canWrite: false } as CommentMode}>
      <ReactionsProvider
        connection={connection}
        schedule={(run, ms) => {
          timers.push({ run, ms });
          return () => undefined;
        }}
      >
        <Probe />
      </ReactionsProvider>
    </commentContext.Provider>,
  );
  return {
    send,
    sent,
    timers,
    hear: (event: ReactionEvent) => {
      for (const listener of listeners) listener(event);
    },
    choose: (action: ShellAction) => {
      if (choose === undefined) throw new Error('No key dispatch');
      choose(action);
    },
    current: () => {
      if (reactions === undefined) throw new Error('No reactions');
      return reactions;
    },
  };
}

describe('reaction acceptance at the board boundary', () => {
  it('lets a viewer see a remote reaction but never open, arm, drop or repeat one', () => {
    const f = setup(true);
    act(() => {
      f.current().toggle();
      f.current().arm('👍');
      f.current().drop(PLACE);
      f.current().repeat();
    });
    expect([f.current().canReact, f.current().isOpen, f.current().armed]).toEqual([
      false,
      false,
      null,
    ]);
    act(() => {
      f.hear({ emoji: '🎉', ...PLACE, from: 'user:b' });
    });
    act(() => {
      f.current().repeat();
      f.current().drop(PLACE);
    });
    expect(f.current().shown.map(({ emoji }) => emoji)).toEqual(['🎉']);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does nothing for +1 before the first reaction and refuses an out-of-bounds drop without showing it', () => {
    const f = setup();
    act(() => {
      f.current().repeat();
    });
    expect(f.send).not.toHaveBeenCalled();
    act(() => {
      f.current().arm('👀');
    });
    act(() => {
      f.current().drop({ ...PLACE, x: 2e9 });
    });
    expect(f.sent).toEqual([]);
    expect(f.current().shown).toEqual([]);
    expect(f.current().last).toBeUndefined();
  });

  it('closes the flyout and disarms when another tool is chosen', () => {
    const f = setup();
    act(() => {
      f.current().toggle();
      f.current().arm('👍');
    });
    expect([f.current().isOpen, f.current().armed]).toEqual([true, '👍']);
    act(() => {
      f.choose({ type: 'selectTool', tool: 'hand' });
    });
    expect([f.current().isOpen, f.current().armed]).toEqual([false, null]);
    act(() => {
      f.current().drop(PLACE);
    });
    expect(f.sent).toEqual([]);
  });

  it('keeps only the newest 40 and removes each at 1600 ms', () => {
    const f = setup();
    act(() => {
      for (let x = 0; x < MAX_SHOWN_REACTIONS + 3; x++) {
        f.hear({ emoji: '❤️', ...PLACE, x, from: 'user:b' });
      }
    });
    expect(f.current().shown.map(({ x }) => x)).toEqual(
      [...Array(40).keys()].map((index: number) => index + 3),
    );
    expect(f.timers).toHaveLength(43);
    expect(f.timers.every(({ ms }) => ms === REACTION_LIFETIME_MS)).toBe(true);
    act(() => {
      f.timers[3]?.run();
    });
    expect(f.current().shown.map(({ x }) => x)).toEqual(
      [...Array(39).keys()].map((index: number) => index + 4),
    );
  });
});
