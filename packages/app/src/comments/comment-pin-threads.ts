import { useEffect, useRef } from 'react';

import { deleteObjectsCommand, runCommand, syncCommentThreads } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import { commentRequest, type Thread } from './comment-api.js';

/**
 * Deletes a thread from its card: through its pins (every comment object of the
 * thread) when the person may edit the board and one is in the document (one undo step; the pin
 * watcher then deletes the thread in the service, and restores it on undo), else in the service
 * directly (a commenter, or a thread with no pin). Closes the card first.
 *
 * @param connection - The live board.
 * @param canEdit - Whether the person may edit the board.
 * @param change - The provider's service write.
 * @param select - Sets the open thread.
 * @returns The action.
 */
export function threadDeletion(
  connection: BoardConnection,
  canEdit: boolean,
  change: (suffix: string, body?: unknown, method?: 'POST' | 'DELETE') => Promise<void>,
  select: (id: string | undefined) => void,
): (thread: Thread) => Promise<void> {
  return async (thread) => {
    select(undefined);
    // Every pin of the thread (a copied pin shares its thread), so the watcher deletes it.
    const pins = [...connection.store.read().objects.values()]
      .filter((object) => object.type === 'comment' && object.threadId === thread.id)
      .map(({ id }) => id);
    if (canEdit && pins.length > 0) {
      const result = runCommand(
        connection.store,
        connection.origin,
        deleteObjectsCommand,
        { ids: pins },
        { clock: Date.now, createId: () => crypto.randomUUID() as ObjectId },
      );
      if (result.status === 'applied') return;
    }
    await change(`/${encodeURIComponent(thread.id)}`, undefined, 'DELETE');
  };
}

/** What the pin watcher reports to. */
export interface PinThreadSinks {
  /** Fetches the threads again after a change. */
  readonly refresh: () => Promise<void>;
  /** Displays recoverable failures. */
  readonly setError: (message: string) => void;
  /** Session-expiry handling. */
  readonly onSessionError: (error: unknown) => boolean;
}

/**
 * Keeps the boards service's threads in step with the person's own pin changes (
 * `watchCommentPins`): a thread whose pin the person deleted (the layers panel, the Delete key,
 * a cut, a page delete, the card's "Delete thread") is deleted in the service, and one their undo
 * pinned again is restored, one thread's writes in order (`syncCommentThreads`), so a deleted
 * comment is gone from every reader and canvas undo brings it back. Watches the whole board,
 * never the page view. Nothing is sent once the session ended.
 *
 * @param connection - The live board, if any.
 * @param boardId - Board id.
 * @param canWrite - Whether the person may write comments.
 * @param isEnded - Whether the session is over now.
 * @param sinks - Refresh and error display.
 */
export function usePinThreads(
  connection: BoardConnection | undefined,
  boardId: string,
  canWrite: boolean,
  isEnded: () => boolean,
  sinks: PinThreadSinks,
): void {
  const latest = useRef(sinks);
  latest.current = sinks;
  useEffect(() => {
    if (connection === undefined || !canWrite) return;
    const write = (suffix: string, method: 'POST' | 'DELETE') =>
      isEnded() ? Promise.resolve() : commentRequest(boardId, method, suffix);
    const sync = syncCommentThreads(
      connection.store,
      {
        deleteThread: (id) => write(`/${encodeURIComponent(id)}`, 'DELETE'),
        restoreThread: (id) => write(`/${encodeURIComponent(id)}/restore`, 'POST'),
      },
      (cause) => {
        if (isEnded()) return;
        if (cause !== undefined && !latest.current.onSessionError(cause))
          latest.current.setError('A comment could not be deleted or restored. Try again.');
        void latest.current.refresh();
      },
    );
    return () => {
      sync.stop();
    };
  }, [connection, boardId, canWrite, isEnded]);
}
