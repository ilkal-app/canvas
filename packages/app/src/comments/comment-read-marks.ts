import { useEffect, useRef } from 'react';

import { commentRequest, type Thread } from './comment-api.js';
import { isUnread } from './comment-unread.js';

/**
 * Marks the open thread read: when the person opens a thread with a message by
 * someone else since they last read it, or one arrives while it is open, the service records
 * their own mark and the list is read again, so the unread counts follow. One request per unread
 * state on each board (a request begun for an earlier board rereads nothing); a failed
 * one (an older service, the network) leaves the thread unread, to try again.
 *
 * @param input - The board, its threads, the open one, the person and the reread.
 * @param input.boardId - The board.
 * @param input.threads - Its threads.
 * @param input.selectedId - The open thread's id, if one is open.
 * @param input.userId - The person.
 * @param input.isLive - Whether the board is live and the session going: nothing is marked
 *   while the connection is absent or the session has ended (live when not said).
 * @param input.refresh - Reads the threads again.
 */
export function useReadMarks(input: {
  readonly boardId: string;
  readonly threads: readonly Thread[];
  readonly selectedId: string | undefined;
  readonly userId: string;
  readonly isLive?: boolean | undefined;
  readonly refresh: () => Promise<void>;
}): void {
  const { boardId, userId, refresh } = input;
  const isLive = input.isLive !== false;
  const thread = input.threads.find((entry) => entry.id === input.selectedId);
  const asked = useRef('');
  // The board now: a request begun for an earlier board rereads nothing once it answers.
  const board = useRef(boardId);
  board.current = boardId;
  const isThreadUnread = thread !== undefined && isUnread(thread, userId);
  const key =
    thread === undefined ? '' : `${boardId} ${thread.id} ${thread.messages.at(-1)?.id ?? ''}`;
  useEffect(() => {
    if (!isLive || !isThreadUnread || asked.current === key) return;
    asked.current = key;
    commentRequest(boardId, 'POST', `/${thread.id}/read`).then(
      () => (board.current === boardId ? refresh() : undefined),
      () => {
        if (asked.current === key) asked.current = '';
      },
    );
  }, [boardId, thread, isLive, isThreadUnread, key, refresh]);
}
