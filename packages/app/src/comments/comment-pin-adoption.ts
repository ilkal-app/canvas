import { useEffect, useRef } from 'react';

import {
  applyTransform,
  objectToBoardTransform,
  shownPageIdOf,
  type Board,
  type ObjectId,
} from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import { commentRequest, type Thread, type ThreadPin } from './comment-api.js';

/**
 * A thread's document pin as the service keeps pins: the comment object it was started
 * on (`pinId`), the one pin the comment layer has drawn, with the page it shows on, its anchor and
 * its board point now. A copy another page's duplicate made (same thread, another id) was never
 * drawn and is never adopted: the ruling drops those copies. Pure.
 *
 * @param board - The whole board.
 * @param thread - The thread.
 * @returns The pin to adopt, or undefined when its comment object is gone.
 */
function documentPinOf(board: Board, thread: Thread): ThreadPin | undefined {
  const object = board.objects.get(thread.pinId as ObjectId);
  if (object?.type !== 'comment') return undefined;
  const { anchor } = object;
  const target = anchor.kind === 'object' ? board.objects.get(anchor.objectId) : undefined;
  const point =
    target !== undefined && anchor.kind === 'object'
      ? applyTransform(objectToBoardTransform(board, target), anchor.offset)
      : { x: object.x, y: object.y };
  return {
    pageId: shownPageIdOf(board, object),
    anchor:
      anchor.kind === 'object'
        ? { kind: 'object', objectId: anchor.objectId, offset: anchor.offset }
        : { kind: 'point' },
    point,
  };
}

/**
 * Moves the pins of threads still pinned by a document object into the service: each
 * such thread's pin is adopted (`PUT …/:threadId/pin` with `adopt: true`, which fills only a pin
 * not yet set, so two people adopting at once keep the first), then the threads are read again.
 * One request per thread while it is in flight or after it succeeded; a failed one is asked again
 * the next time the threads change. Nothing for a person who may not comment.
 *
 * @param input - The board, its threads, its document, whether the person comments and the reread.
 * @param input.boardId - The board.
 * @param input.threads - Its threads.
 * @param input.connection - The live board, whose document holds the pins to adopt.
 * @param input.canWrite - Whether the person may comment (a viewer adopts nothing).
 * @param input.refresh - Reads the threads again.
 */
export function useAdoptPins(input: {
  readonly boardId: string;
  readonly threads: readonly Thread[];
  readonly connection: Pick<BoardConnection, 'store'> | undefined;
  readonly canWrite: boolean;
  readonly refresh: () => Promise<void>;
}): void {
  const { boardId, threads, connection, canWrite, refresh } = input;
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!canWrite || connection === undefined) return;
    const board = connection.store.read();
    const adoptions = threads.flatMap((thread) => {
      if (thread.pin || asked.current.has(thread.id)) return [];
      const pin = documentPinOf(board, thread);
      if (pin === undefined) return [];
      asked.current.add(thread.id);
      const suffix = `/${encodeURIComponent(thread.id)}/pin`;
      return [
        commentRequest(boardId, 'PUT', suffix, { pin, adopt: true }).then(
          () => true,
          () => {
            asked.current.delete(thread.id);
            return false;
          },
        ),
      ];
    });
    if (adoptions.length === 0) return;
    void Promise.all(adoptions).then((results) => {
      if (results.includes(true)) void refresh();
    });
  }, [boardId, threads, connection, canWrite, refresh]);
}
