import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ReactionChannel } from '@canvas/collab';
import type { ReactionEmoji } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import { useCanEdit } from '../collab/use-can-edit.js';
import { useCommentMode } from '../comments/comment-context.js';
import { useAnnounce } from '../feedback/live-announcer.js';

import { ReactionAnnouncementThrottle } from './reaction-announcements.js';
import {
  MAX_SHOWN_REACTIONS,
  REACTION_LIFETIME_MS,
  reactionsContext,
  REPEAT_OFFSET,
  type BoardReactions,
  type ReactionPlace,
  type ShownReaction,
} from './reactions-context.js';

/** Props of {@link ReactionsProvider}. */
export interface ReactionsProviderProps {
  /** The board's connection: its reactions channel, and the person's role. */
  readonly connection: Pick<BoardConnection, 'reactions' | 'status' | 'subscribe'> | undefined;
  /**
   * The reactions channel when the connection has none (the harness's own, `?reactions=local`,
   *); the connection's channel wins.
   */
  readonly reactions?: Pick<ReactionChannel, 'send' | 'subscribe'> | undefined;
  /** Schedules a reaction's removal; `setTimeout` if absent (tests pass a fake clock's). */
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
  /** The shell. */
  readonly children: ReactNode;
}

/**
 * Schedules with the page's timers.
 *
 * @param run - What to run.
 * @param ms - After how long.
 * @returns A function that cancels it.
 */
function pageSchedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
}

/**
 * The reactions shown over the board and their removal after {@link REACTION_LIFETIME_MS}, at
 * most {@link MAX_SHOWN_REACTIONS} at once.
 *
 * @param schedule - Schedules a removal.
 * @returns The reactions shown and a way to show one more.
 */
function useShownReactions(schedule: (run: () => void, ms: number) => () => void): {
  readonly shown: readonly ShownReaction[];
  readonly show: (reaction: Omit<ShownReaction, 'id'>) => void;
} {
  const [shown, setShown] = useState<readonly ShownReaction[]>([]);
  const nextId = useRef(0);
  const cancels = useRef(new Set<() => void>());
  useEffect(() => {
    const pending = cancels.current;
    return () => {
      for (const cancel of pending) cancel();
      pending.clear();
    };
  }, []);
  const show = useCallback(
    (reaction: Omit<ShownReaction, 'id'>) => {
      const id = ++nextId.current;
      setShown((current) => [...current, { ...reaction, id }].slice(-MAX_SHOWN_REACTIONS));
      const cancel = schedule(() => {
        cancels.current.delete(cancel);
        setShown((current) => current.filter((item) => item.id !== id));
      }, REACTION_LIFETIME_MS);
      cancels.current.add(cancel);
    },
    [schedule],
  );
  return { shown, show };
}

/**
 * Tells a screen reader of other people's reactions through the page's live region,
 * throttled (`ReactionAnnouncementThrottle`): the first at once, a burst as one count when its
 * interval ends, on the page's timers and clock (`schedule` is for removals only). The
 * interval's timer flushes and schedules the next from the clock when it fires.
 *
 * @returns What takes another person's reaction.
 */
function useReactionAnnouncements(): (emoji: ReactionEmoji) => void {
  const announce = useAnnounce();
  const [throttle] = useState(() => new ReactionAnnouncementThrottle());
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );
  return useCallback(
    (emoji: ReactionEmoji) => {
      const at = Date.now();
      const said = throttle.add(emoji, at);
      if (said !== undefined) announce(said);
      if (cancel.current !== undefined) return;
      const flushLater = (from: number): void => {
        const endsAt = throttle.nextFlushAt();
        if (endsAt === undefined) {
          cancel.current = undefined;
          return;
        }
        cancel.current = pageSchedule(
          () => {
            // The clock now, not the interval's end: a timer held back (a suspended tab) must
            // not push the next interval past five seconds from now. Early, it waits the rest.
            const firedAt = Date.now();
            const gathered = throttle.flush(firedAt);
            if (gathered !== undefined) announce(gathered);
            flushLater(firedAt);
          },
          Math.max(endsAt - from, 0),
        );
      };
      flushLater(at);
    },
    [announce, throttle],
  );
}

/**
 * The board's reactions for the shell, on a board with a relay: everyone else's from
 * the connection's channel, shown where they were dropped, and the person's own, sent and shown
 * at once (the relay never echoes them). An editor or a commenter may react; a viewer only sees
 * them (; the relay drops a viewer's anyway). "+1" repeats the last reaction
 * anyone dropped, beside it. Everyone else's are told to a screen reader, throttled.
 *
 * @param props - The connection and the shell.
 * @returns The provider.
 */
export function ReactionsProvider(props: ReactionsProviderProps): ReactNode {
  const { connection } = props;
  const channel = connection?.reactions ?? props.reactions;
  const canWriteComments = useCommentMode()?.canWrite === true;
  const canEdit = useCanEdit(connection);
  const canReact = channel !== undefined && (canEdit || canWriteComments);
  const { shown, show } = useShownReactions(props.schedule ?? pageSchedule);
  const tell = useReactionAnnouncements();
  const [isOpen, setIsOpen] = useState(false);
  const [armed, setArmed] = useState<ReactionEmoji | null>(null);
  const [last, setLast] = useState<BoardReactions['last']>(undefined);
  const centre = useRef<(() => ReactionPlace) | undefined>(undefined);
  const provideCentre = useCallback((source: (() => ReactionPlace) | undefined) => {
    centre.current = source;
  }, []);
  useEffect(() => {
    if (channel === undefined) return undefined;
    return channel.subscribe((event) => {
      const { emoji, x, y, pageId } = event;
      show({ emoji, x, y, pageId, isOwn: false });
      setLast({ emoji, x, y, pageId });
      tell(emoji);
    });
  }, [channel, show, tell]);
  const send = useCallback(
    (emoji: ReactionEmoji, place: ReactionPlace) => {
      if (channel === undefined || !canReact) return;
      try {
        channel.send({ emoji, ...place });
      } catch {
        // Off the board's bounds: the wire refuses it, so it is not shown either.
        return;
      }
      show({ emoji, ...place, isOwn: true });
      setLast({ emoji, ...place });
    },
    [channel, canReact, show],
  );
  const value = useMemo(
    (): BoardReactions => ({
      canReact,
      isOpen: isOpen && canReact,
      armed: canReact ? armed : null,
      last,
      shown,
      toggle: () => {
        setIsOpen((wasOpen) => !wasOpen);
        setArmed(null);
      },
      close: () => {
        setIsOpen(false);
        setArmed(null);
      },
      arm: setArmed,
      drop: (place) => {
        if (armed !== null) send(armed, place);
      },
      repeat: () => {
        if (last === undefined) return;
        const { emoji, pageId } = last;
        send(emoji, { x: last.x + REPEAT_OFFSET, y: last.y - REPEAT_OFFSET, pageId });
      },
      sendAtCentre: (emoji) => {
        const place = centre.current?.();
        if (place !== undefined) send(emoji, place);
      },
      provideCentre,
    }),
    [canReact, isOpen, armed, last, shown, send, provideCentre],
  );
  return <reactionsContext.Provider value={value}>{props.children}</reactionsContext.Provider>;
}
