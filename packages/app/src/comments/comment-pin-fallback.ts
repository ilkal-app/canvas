import { useEffect, useRef } from 'react';

import type { Point } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import { commentRequest, type Thread, type ThreadPin } from './comment-api.js';
import { useAdoptPins } from './comment-pin-adoption.js';
import { useCleanDocumentPins } from './comment-pin-cleanup.js';
import { threadPinPlaceOf } from './thread-pin-place.js';

/**
 * Keeps the spot of each object pin kept in the service where its object last was: when
 * one of the person's own changes deletes the object a pin follows, or moves it off the pin's
 * page, the pin's point becomes where the pin last showed (`PUT …/:threadId/pin`), so it stays
 * there, as a document pin became a point pin where it was. The pin keeps its object, so an undo
 * that brings the object back has it followed again. A remote change tells nothing: the person who
 * made it updates the point. Only a person who may edit the board changes objects, so only they
 * write.
 *
 * @param input - The board, its threads, its document, whether the person edits and the reread.
 * @param input.boardId - The board.
 * @param input.threads - Its threads.
 * @param input.connection - The live board.
 * @param input.canEdit - Whether the person may edit the board.
 * @param input.refresh - Reads the threads again.
 */
export function useKeepPinFallbacks(input: {
  readonly boardId: string;
  readonly threads: readonly Thread[];
  readonly connection: Pick<BoardConnection, 'store'> | undefined;
  readonly canEdit: boolean;
  readonly refresh: () => Promise<void>;
}): void {
  const { boardId, threads, connection, canEdit, refresh } = input;
  // Where each followed pin showed after the last change: on its object, on its page.
  const followed = useRef(new Map<string, Point>());
  useEffect(() => {
    if (connection === undefined) return undefined;
    const { store } = connection;
    const objectPins = threads.filter((thread) => thread.pin?.anchor.kind === 'object');
    const track = (): { readonly id: string; readonly pin: ThreadPin }[] => {
      const board = store.read();
      const last = followed.current;
      const next = new Map<string, Point>();
      const lost: { readonly id: string; readonly pin: ThreadPin }[] = [];
      for (const { id, pinId, pin } of objectPins) {
        if (!pin) continue;
        const place = threadPinPlaceOf(board, { pinId, pin });
        const point = last.get(id);
        if (place?.target !== undefined) next.set(id, place.point);
        else if (point !== undefined) lost.push({ id, pin: { ...pin, point } });
      }
      followed.current = next;
      return lost;
    };
    track();
    return store.subscribe((changes) => {
      const lost = track();
      if (!canEdit || !changes.isLocal || changes.origin.kind === 'system') return;
      const writes = lost.map(({ id, pin }) =>
        commentRequest(boardId, 'PUT', `/${encodeURIComponent(id)}/pin`, { pin }),
      );
      if (writes.length > 0) void Promise.allSettled(writes).then(() => refresh());
    });
  }, [boardId, threads, connection, canEdit, refresh]);
}

/**
 * Everything the client does for pins kept in the service: adopts the pins still in the
 * document (`useAdoptPins`), keeps object pins' spots where their objects last were
 * (`useKeepPinFallbacks`) and removes the document's pins the service has made stale
 * (`useCleanDocumentPins`).
 *
 * @param input - The board, its threads, its document, the person's rights and the reread.
 * @param input.boardId - The board.
 * @param input.threads - Its threads.
 * @param input.connection - The live board.
 * @param input.canWrite - Whether the person may comment.
 * @param input.canEdit - Whether the person may edit the board.
 * @param input.checkedPinIds - The comment objects in the document when the threads in hand were
 *   asked for; undefined until they have loaded.
 * @param input.refresh - Reads the threads again.
 */
export function useServicePins(input: {
  readonly boardId: string;
  readonly threads: readonly Thread[];
  readonly connection: Pick<BoardConnection, 'store'> | undefined;
  readonly canWrite: boolean;
  readonly canEdit: boolean;
  readonly checkedPinIds: ReadonlySet<string> | undefined;
  readonly refresh: () => Promise<void>;
}): void {
  useAdoptPins(input);
  useKeepPinFallbacks(input);
  useCleanDocumentPins(input);
}
