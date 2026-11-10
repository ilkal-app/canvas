import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import { useCanEdit } from '../collab/use-can-edit.js';
import type { BoardMembers, Member, Person } from '../service/board-people.js';
import { useDrawerSlot, type DrawerSlot } from '../shell/drawer-slot.js';

import { commentRequest, type Thread } from './comment-api.js';
import { commentContext, commentsPendingContext, type CommentMode } from './comment-context.js';
import { commentDataContext } from './comment-data-context.js';
import { useSelectedThread } from './comment-deep-link.js';
import { commentObjectIdsOf } from './comment-pin-cleanup.js';
import { useServicePins } from './comment-pin-fallback.js';
import { threadDeletion, usePinThreads } from './comment-pin-threads.js';
import type { CommentPlacement } from './comment-placement.js';
import { useReadMarks } from './comment-read-marks.js';
import { unreadCommentsOf } from './comment-unread.js';
import { useResolvedToggle } from './use-resolved-toggle.js';

/** No members read yet: the same empty list every render. */
const NO_MEMBERS: readonly Member[] = [];

/** Where the comments read a board's people from: the site's API client. */
export interface MemberDirectory {
  /**
   * The board's people (`GET /api/boards/:id/members`).
   *
   * @param boardId - The board.
   * @returns Its members and agent keys.
   */
  listMembers(boardId: string): Promise<BoardMembers>;
}

/** Site context for a live board's relational comments. */
export interface CommentProviderProps {
  /** Live board; absent while the cached preview awaits hydration. */
  readonly connection: BoardConnection | undefined;
  /** Board id. */
  readonly boardId: string;
  /** Signed-in person. */
  readonly user: Person;
  /** Member directory client. */
  readonly client: MemberDirectory;
  /** Session-expiry handling. */
  readonly onSessionError: (error: unknown) => boolean;
  /**
   * Whether the person's role may write comments though not edit the board (a commenter,
   *); an editor may whatever this says. False if absent.
   */
  readonly canComment?: boolean;
  /**
   * Whether the session ended while the board was open: nothing more is asked of the
   * service (comments and members are not loaded again, nothing is written). False if absent.
   */
  readonly isSessionEnded?: boolean;
  /**
   * Whether the session is over now, read when a request resolves: a request begun
   * before it ended changes nothing once it answers. Never over if absent.
   */
  readonly hasSessionEnded?: () => boolean;
  /** Shell to wrap. */
  readonly children: ReactNode;
}

/**
 * Fetches comments on open, reconnect and relay invalidation; owns composition independently of canvas undo.
 * Once the session ended (`isSessionEnded`) it asks nothing more of the service.
 * The thread panel opens in the right-hand drawer slot (`useDrawerSlot`), one at a time
 * with the inspector and the history panel.
 *
 * @param props - Board services and shell.
 * @returns Comments contexts around the shell.
 */
export function CommentProvider(props: CommentProviderProps): ReactElement {
  const { connection, boardId, user, onSessionError } = props;
  const canEdit = useCanEdit(connection);
  const isLive = connection !== undefined && props.isSessionEnded !== true;
  const canWrite = isLive && (canEdit || props.canComment === true);
  const [threads, setThreads] = useState<readonly Thread[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMembers>();
  const [isPlacing, setPlacing] = useState(false);
  const resolved = useResolvedToggle();
  // The thread panel takes the right-hand drawer slot, putting away the inspector or history.
  const slot = useDrawerSlot();
  const [selectedId, setSelectedId] = useSelectedThread(threads);
  const [placement, setPlacement] = useState<CommentPlacement>();
  const [error, setError] = useState('');
  const [isBusy, setBusy] = useState(false);
  const isEnded = useEndedCheck(props);
  const loading = useThreadLoading(props, isEnded, { setThreads, setBoardMembers, setError });
  const { refresh, checkedPinIds } = loading;
  usePinThreads(connection, boardId, canWrite, isEnded, { refresh, setError, onSessionError });
  useReadMarks({ boardId, threads, selectedId, userId: user.id, isLive, refresh });
  const pinRights = { canWrite, canEdit: canEdit && canWrite, checkedPinIds };
  useServicePins({ boardId, threads, connection, ...pinRights, refresh });
  const change = async (
    suffix: string,
    body?: unknown,
    method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  ): Promise<void> => {
    if (connection === undefined || !canWrite || isBusy) return;
    setBusy(true);
    setError('');
    try {
      const answer = await commentRequest(boardId, method, suffix, body);
      if (isEnded()) return; // Begun before the session ended: no reload.
      if (placement && answer.thread) {
        setSelectedId(answer.thread.id);
        setPlacement(undefined);
      }
      await refresh();
    } catch (cause) {
      if (!onSessionError(cause))
        setError('Your change could not be saved. Check your connection and try again.');
      throw cause;
    } finally {
      setBusy(false);
    }
  };
  const unread = unreadCommentsOf(threads, user.id);
  const mode = { ...commentMode(canWrite, isPlacing, setPlacing, slot), ...resolved, unread };
  return (
    <commentsPendingContext.Provider value={!isLive && props.isSessionEnded !== true}>
      <commentContext.Provider value={connection === undefined ? undefined : mode}>
        <commentDataContext.Provider
          value={
            connection === undefined
              ? undefined
              : {
                  connection,
                  user,
                  threads,
                  members: boardMembers?.members ?? NO_MEMBERS,
                  boardMembers,
                  selectedId,
                  placement,
                  error,
                  isBusy,
                  canEditBoard: canEdit && canWrite,
                  change,
                  movePin: (thread, pin) => change(`/${thread.id}/pin`, { pin }, 'PUT'),
                  deleteThread: threadDeletion(connection, canEdit, change, setSelectedId),
                  refresh,
                  ...commentNavigation(setSelectedId, setPlacement, setPlacing),
                }
          }
        >
          {props.children}
        </commentDataContext.Provider>
      </commentContext.Provider>
    </commentsPendingContext.Provider>
  );
}

/**
 * Whether the session is over now: the page's word as of the last render, or the
 * session's own as of its latest change; one function, which reads the latest of both.
 *
 * @param props - Whether the session ended, and the session's live check.
 * @returns The check.
 */
function useEndedCheck(props: CommentProviderProps): () => boolean {
  const latest = useRef(props);
  latest.current = props;
  return useCallback(
    () => latest.current.isSessionEnded === true || latest.current.hasSessionEnded?.() === true,
    [],
  );
}

/**
 * The comment mode the toolbar and overlay read: whether the person writes, places a comment or
 * has the thread panel open in the drawer slot, and the actions that change it.
 *
 * @param canWrite - Whether the person may write comments.
 * @param isPlacing - Whether the placement gesture is armed.
 * @param setPlacing - Arms or disarms it.
 * @param slot - The right-hand drawer slot.
 * @returns The mode.
 */
function commentMode(
  canWrite: boolean,
  isPlacing: boolean,
  setPlacing: (isPlacing: boolean) => void,
  slot: DrawerSlot,
): CommentMode {
  const isPanelOpen = slot.occupant === 'comments';
  return {
    canWrite,
    isPlacing: isPlacing && canWrite,
    isPanelOpen,
    setPlacing,
    togglePanel: () => {
      if (isPanelOpen) slot.release('comments');
      else slot.claim('comments');
    },
  };
}

/** Where loading publishes what it read. */
interface ThreadSinks {
  /** Publishes the latest response. */
  readonly setThreads: (threads: readonly Thread[]) => void;
  /** Publishes the board's members and agents (mention choices and sticky authors), or none. */
  readonly setBoardMembers: (members: BoardMembers | undefined) => void;
  /** Displays recoverable failures. */
  readonly setError: (message: string) => void;
}

/**
 * Loads the relational state and refreshes after reconnects and invalidations; nothing is asked
 * once the session ended, and an answer that arrives after it is dropped: a refresh
 * (Try again included) does nothing then.
 *
 * @param props - Board services.
 * @param isEnded - Whether the session is over now.
 * @param sinks - Where what was read goes.
 * @returns A refresh action, and the document's comment objects when the threads in hand were
 *   asked for; undefined until this board's threads have been read ('s cleanup waits for
 *   them, and takes only those pins for orphans).
 */
function useThreadLoading(
  props: CommentProviderProps,
  isEnded: () => boolean,
  sinks: ThreadSinks,
): {
  readonly refresh: () => Promise<void>;
  readonly checkedPinIds: ReadonlySet<string> | undefined;
} {
  const { boardId, connection, client, onSessionError } = props;
  const { setThreads, setBoardMembers, setError } = sinks;
  const isSessionEnded = props.isSessionEnded === true;
  const serial = useRef(0);
  const [checked, setChecked] = useState<{ boardId: string; pinIds: ReadonlySet<string> }>();
  const refresh = useCallback(async () => {
    if (isEnded()) return;
    const request = ++serial.current;
    // The document's pins as the list is asked for: none written later is taken for an orphan.
    const pinIds = connection ? commentObjectIdsOf(connection.store.read()) : new Set<string>();
    try {
      const answer = await commentRequest(boardId, 'GET');
      if (request !== serial.current || isEnded()) return;
      setThreads(answer.threads ?? []);
      setChecked({ boardId, pinIds });
    } catch (cause) {
      if (request === serial.current && !onSessionError(cause) && !isEnded())
        setError('Comments could not be loaded. Try again.');
    }
  }, [boardId, connection, onSessionError, isEnded, setThreads, setError]);
  useEffect(() => {
    // Names read for an earlier board, connection or session never outlive it (a sticky
    // author is drawn only while the person may read the member list).
    setBoardMembers(undefined);
    if (connection === undefined || isSessionEnded) return;
    let isCurrent = true;
    void refresh();
    void client
      .listMembers(boardId)
      .then((answer) => {
        if (isCurrent && !isEnded()) setBoardMembers(answer);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        setBoardMembers(undefined);
        onSessionError(cause);
      });
    const notice = connection.onThreadsChanged?.(() => {
      void refresh();
    });
    let previous = connection.status().state;
    const status = connection.subscribe(() => {
      const next = connection.status().state;
      if (next === 'connected' && previous !== next) void refresh();
      previous = next;
    });
    return () => {
      isCurrent = false;
      serial.current++;
      notice?.();
      status();
    };
  }, [
    boardId,
    client,
    connection,
    isSessionEnded,
    isEnded,
    onSessionError,
    refresh,
    setBoardMembers,
  ]);
  return { refresh, checkedPinIds: checked?.boardId === boardId ? checked.pinIds : undefined };
}

/**
 * Selection actions shared by the panel, pins and placement control.
 *
 * @param select - Sets the selected thread.
 * @param place - Sets a pending placement.
 * @param placing - Activates the placement gesture.
 * @returns Navigation actions.
 */
function commentNavigation(
  select: (id: string | undefined) => void,
  place: (placement: CommentPlacement | undefined) => void,
  placing: (isPlacing: boolean) => void,
) {
  return {
    close: () => {
      select(undefined);
      place(undefined);
      placing(false);
    },
    select: (id: string) => {
      place(undefined);
      select(id);
      placing(false);
    },
    place: (next: CommentPlacement) => {
      place(next);
      select(undefined);
      placing(false);
    },
  };
}
