import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import { useCanEdit } from '../collab/use-can-edit.js';
import { useAnnounce } from '../feedback/live-announcer.js';
import { ApiError } from '../service/api-error.js';

import { voteRevealAnnouncementOf } from './vote-announcement.js';
import { voteApiFor, type VoteApi, type VoteSession } from './vote-api.js';
import {
  isInVoteScope,
  RANKED_STICKIES,
  rankedStickiesOf,
  sectionNameOf,
  type RankedSticky,
} from './vote-board.js';
import { DEFAULT_VOTES_PER_PERSON, voteContext, type BoardVote } from './vote-context.js';
import { keepVoteRecord } from './vote-record.js';

/** Props of {@link VoteProvider}. */
export interface VoteProviderProps {
  /** The board. */
  readonly boardId: string;
  /** Its connection: the vote's notices and the person's role; nothing is read without one. */
  readonly connection: BoardConnection | undefined;
  /** Whether the person's session ended: nothing is asked after. */
  readonly isSessionEnded?: boolean | undefined;
  /** The routes; the board's own if absent (tests pass a fake). */
  readonly api?: VoteApi | undefined;
  /** The shell. */
  readonly children: ReactNode;
}

/**
 * What a failed action says, by the service's refusal.
 *
 * @param cause - What it failed with.
 * @returns The person's words.
 */
function noticeOf(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'vote-limit')
    return 'You have used all your votes';
  if (cause instanceof ApiError && cause.code === 'vote-forbidden') {
    return 'Only the owner and editors vote';
  }
  if (cause instanceof ApiError && (cause.code === 'vote-open' || cause.code === 'vote-closed')) {
    return 'The vote changed. It is shown as it is now.';
  }
  return 'The vote could not be updated. Try again.';
}

/**
 * Reads the board's vote, again on the relay's `votes-changed` notice and after a reconnect, and
 * keeps the latest answer only.
 *
 * @param api - The routes.
 * @param connection - The connection.
 * @param isEnded - Whether the person's session ended.
 * @returns The session, the setter actions use, a read, and the live run of its effect (none
 *   once it ended).
 */
function useVoteLoading(
  api: VoteApi,
  connection: BoardConnection | undefined,
  isEnded: boolean,
): {
  readonly session: VoteSession | null;
  readonly accept: (request: number, session: VoteSession | null) => void;
  readonly next: () => number;
  readonly refresh: () => Promise<void>;
  readonly epoch: () => number | undefined;
} {
  const [session, setSession] = useState<VoteSession | null>(null);
  const serial = useRef(0);
  // Which run of the effect is live, or none: a connection change, the session's end or the
  // unmount ends it, and then nothing more is read and no earlier action's outcome is shown.
  const live = useRef<number | undefined>(undefined);
  const runs = useRef(0);
  const epoch = useCallback(() => live.current, []);
  const next = useCallback(() => ++serial.current, []);
  const accept = useCallback((request: number, answer: VoteSession | null) => {
    // An ended session is the last answer's record only: the board has no current vote.
    if (request === serial.current) setSession(answer?.status === 'ended' ? null : answer);
  }, []);
  const refresh = useCallback(async () => {
    const request = next();
    try {
      accept(request, await api.read());
    } catch {
      // A read that fails keeps what was shown; the next notice or reconnect reads again.
    }
  }, [api, accept, next]);
  useEffect(() => {
    if (connection === undefined || isEnded) return undefined;
    live.current = ++runs.current;
    void refresh();
    const notice = connection.onVotesChanged?.(() => {
      void refresh();
    });
    let previous = connection.status().state;
    const status = connection.subscribe(() => {
      const state = connection.status().state;
      if (state === 'connected' && previous !== state) void refresh();
      previous = state;
    });
    return () => {
      live.current = undefined;
      serial.current++;
      notice?.();
      status();
    };
  }, [connection, isEnded, refresh]);
  return { session, accept, next, refresh, epoch };
}

/**
 * The person's actions on the vote: whether they may act, the last refusal's words, and a runner
 * that drops an outcome arriving after the session ended, the connection changed or the unmount,
 * and reads the vote again after a refusal.
 *
 * @param api - The routes.
 * @param connection - The connection.
 * @param isEnded - Whether the person's session ended.
 * @returns The session, the role, the notice and its setter, and the runner.
 */
function useVoteActions(
  api: VoteApi,
  connection: BoardConnection | undefined,
  isEnded: boolean,
): {
  readonly session: VoteSession | null;
  readonly canVote: boolean;
  readonly notice: string | undefined;
  readonly setNotice: (notice: string | undefined) => void;
  readonly act: (run: () => Promise<VoteSession | null>) => void;
} {
  const canVote = useCanEdit(connection) && connection !== undefined && !isEnded;
  const { session, accept, next, refresh, epoch } = useVoteLoading(api, connection, isEnded);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const act = useCallback(
    (run: () => Promise<VoteSession | null>) => {
      if (!canVote) return;
      setNotice(undefined);
      const request = next();
      const started = epoch();
      // An outcome after the session ended, the connection changed or the unmount is dropped.
      const isCurrent = (): boolean => started !== undefined && epoch() === started;
      run().then(
        (answer) => {
          if (isCurrent()) accept(request, answer);
        },
        (cause: unknown) => {
          if (!isCurrent()) return;
          setNotice(noticeOf(cause));
          void refresh();
        },
      );
    },
    [canVote, accept, next, refresh, epoch],
  );
  return { session, canVote, notice, setNotice, act };
}

/**
 * What the vote reads from the board: whether a sticky counts (its section), the
 * section's name and the ranked results; and the voting cursor, on only while the person may
 * cast (it goes off when the vote stops casting).
 *
 * @param connection - The connection, whose store is read.
 * @param session - The session.
 * @param canVote - Whether the person may cast.
 * @returns The board's side of {@link BoardVote}.
 */
function useVoteBoard(
  connection: BoardConnection | undefined,
  session: VoteSession | null,
  canVote: boolean,
): Pick<BoardVote, 'isInScope' | 'sectionName' | 'ranked' | 'isCursorOn' | 'setCursorOn'> {
  const store = connection?.store;
  const scopeId = session?.scopeId ?? null;
  const isInScope = useCallback(
    (objectId: string) => store === undefined || isInVoteScope(store, objectId, scopeId),
    [store, scopeId],
  );
  const [isCursorWanted, setCursorOn] = useState(false);
  const isCasting = canVote && session?.status === 'open';
  useEffect(() => {
    if (!isCasting) setCursorOn(false);
  }, [isCasting]);
  const isCursorOn = isCasting && isCursorWanted;
  // Read again only when the session changes (a sticky's text edited since shows at the next
  // one), not when the cursor turns on or off.
  const read = useMemo(
    () => ({
      sectionName:
        scopeId === null || store === undefined ? undefined : sectionNameOf(store, scopeId),
      ranked:
        store === undefined || session === null
          ? []
          : rankedStickiesOf(store, session, RANKED_STICKIES),
    }),
    [scopeId, store, session],
  );
  return useMemo(
    () => ({ ...read, isInScope, isCursorOn, setCursorOn }),
    [read, isInScope, isCursorOn],
  );
}

/**
 * What End does to a session: reveals a hidden vote's results first (the service gives an ended
 * hidden vote no results, so ending first would lose them); else ends it and, once the service
 * has, keeps its results on the board as the person's record.
 *
 * @param session - The session.
 * @param api - The routes.
 * @param connection - The connection, whose store takes the record.
 * @returns The call to run.
 */
function finishOf(
  session: VoteSession,
  api: VoteApi,
  connection: BoardConnection | undefined,
): () => Promise<VoteSession | null> {
  if (session.status === 'open' && session.isHidden) return () => api.reveal(session.id);
  return () =>
    api.end(session.id).then((answer) => {
      if (connection !== undefined) keepVoteRecord(connection, session);
      return answer;
    });
}

/**
 * How long a reveal waits for its top sticky to reach this client's board, ms: the
 * service's reveal can arrive before the sticky's own update; past this it is told without it,
 * and whole once the sticky comes.
 */
export const REVEAL_STICKY_WAIT_MS = 2000;

/**
 * Tells a screen reader when the board's vote is revealed: once, as the session seen
 * open turns revealed, with its top sticky (`voteRevealAnnouncementOf`). When the service's
 * leading sticky has not reached this client's board yet, nothing is said until it does: the
 * whole announcement then, or, after {@link REVEAL_STICKY_WAIT_MS}, "Vote results are in." and
 * the whole announcement again when it comes. A vote already revealed when first read (a person joining late),
 * or a different session, is not told.
 *
 * @param session - The board's vote, or `null`.
 * @param store - The board, whose stickies are ranked.
 */
function useVoteRevealAnnouncement(
  session: VoteSession | null,
  store: BoardConnection['store'] | undefined,
): void {
  const announce = useAnnounce();
  const seen = useRef<{ readonly id: string; readonly isRevealed: boolean } | undefined>(undefined);
  // The wait for a top sticky, kept across the session's reads (each a new object) until the
  // session changes, stops being revealed or the provider unmounts.
  const waiting = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      waiting.current?.();
    },
    [],
  );
  useEffect(() => {
    const before = seen.current;
    const now =
      session === null ? undefined : { id: session.id, isRevealed: session.status === 'revealed' };
    seen.current = now;
    if (before?.id !== now?.id || now?.isRevealed !== true) waiting.current?.();
    if (
      session === null ||
      now?.isRevealed !== true ||
      before?.id !== now.id ||
      before.isRevealed
    ) {
      return;
    }
    // The service's leading result: until its sticky is on this client's board, the top sticky
    // read from the board could be a lower one, so it is waited for (a leader deleted meanwhile
    // leaves the preface alone, the wait ending with the session).
    const leader = (session.results ?? []).find(({ count }) => count > 0);
    const isLeaderHere = (): boolean =>
      leader === undefined ||
      store === undefined ||
      store.get(leader.objectId as ObjectId) !== undefined;
    const top = (): RankedSticky[] =>
      store === undefined ? [] : rankedStickiesOf(store, session, 1);
    if (isLeaderHere() || store === undefined) {
      announce(voteRevealAnnouncementOf(top()));
      return;
    }
    // Past the wait the reveal is told without its top sticky. The sticky, when it comes, is
    // told in the whole sentence again: a message replaces one not yet read out
    // (`ANNOUNCE_DELAY_MS`), so the reveal itself is never lost to it.
    const timer = setTimeout(() => {
      announce(voteRevealAnnouncementOf([]));
    }, REVEAL_STICKY_WAIT_MS);
    const unsubscribe = store.subscribe(() => {
      if (!isLeaderHere()) return;
      stop();
      announce(voteRevealAnnouncementOf(top()));
    });
    const stop = (): void => {
      clearTimeout(timer);
      unsubscribe();
      waiting.current = undefined;
    };
    waiting.current = stop;
  }, [session, store, announce]);
}

/**
 * The board's dot vote for the shell's surfaces, on a signed-in board: the current
 * session from the boards service, read again on the relay's notice and after a reconnect, and
 * the owner's and editors' actions on it. A refused action reads the vote again and says why. A
 * vote may cover a section: a sticky outside it is refused with a notice. Its reveal is told
 * to a screen reader.
 *
 * @param props - The board, its connection, the routes and the shell.
 * @returns The provider.
 */
export function VoteProvider(props: VoteProviderProps): ReactNode {
  const { boardId, connection } = props;
  const isEnded = props.isSessionEnded === true;
  const api = useMemo(() => props.api ?? voteApiFor(boardId), [props.api, boardId]);
  const { session, canVote, notice, setNotice, act } = useVoteActions(api, connection, isEnded);
  const board = useVoteBoard(connection, session, canVote);
  useVoteRevealAnnouncement(session, connection?.store);
  const value = useMemo((): BoardVote => {
    const id = session?.id;
    return {
      session,
      canVote,
      notice,
      start: (scope) => {
        act(() => api.start(DEFAULT_VOTES_PER_PERSON, scope ?? null));
      },
      cast: (objectId) => {
        if (id === undefined) return;
        if (board.isInScope?.(objectId) === false) {
          setNotice(`Only stickies in ${board.sectionName ?? 'the section'} count in this vote`);
          return;
        }
        act(() => api.cast(id, objectId));
      },
      retract: (objectId) => {
        if (id !== undefined) act(() => api.retract(id, objectId));
      },
      finish: () => {
        if (session !== null) act(finishOf(session, api, connection));
      },
      ...board,
    };
  }, [session, canVote, notice, setNotice, act, api, connection, board]);
  return <voteContext.Provider value={value}>{props.children}</voteContext.Provider>;
}
