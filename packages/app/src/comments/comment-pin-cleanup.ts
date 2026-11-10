import { useEffect } from 'react';

import { deleteObjectsCommand, runCommand, SYSTEM_ORIGIN, whenStoreIdle } from '@canvas/document';
import type { Board, ObjectId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';

import type { Thread } from './comment-api.js';

/**
 * The document's comment objects a cleanup removes: every pin of a thread whose pin the
 * service now keeps (the adopted pin and any copy a page duplicate made), and every pin of a
 * thread the list does not have (an orphan: a duplicated board's, or a deleted thread's) that was
 * already in the document when that list was asked for. A pin written since may be an older
 * client's, for a thread it created after the list was read: it waits for a list that has its
 * thread or proves it an orphan. A pin of a listed thread the service has no pin for is kept: it is
 * still to be adopted. Pure.
 *
 * @param board - The whole board.
 * @param threads - The board's threads, as listed.
 * @param checkedPinIds - The comment objects in the document when that list was asked for.
 * @returns The ids to delete, in the document's order.
 */
export function stalePinIdsOf(
  board: Board,
  threads: readonly Thread[],
  checkedPinIds: ReadonlySet<string>,
): ObjectId[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return [...board.objects.values()]
    .filter((object) => {
      if (object.type !== 'comment') return false;
      const thread = byId.get(object.threadId);
      return thread === undefined ? checkedPinIds.has(object.id) : Boolean(thread.pin);
    })
    .map(({ id }) => id);
}

/**
 * The ids of a board's comment objects now: what a thread list asked for now is checked against.
 *
 * @param board - The whole board.
 * @returns Their ids.
 */
export function commentObjectIdsOf(board: Board): ReadonlySet<string> {
  return new Set(
    [...board.objects.values()].filter((object) => object.type === 'comment').map(({ id }) => id),
  );
}

/**
 * Removes the document's pins the service has made stale (`stalePinIdsOf`), for a person
 * who may edit the board, once a thread list has loaded (an empty list before then would make
 * every pin an orphan). One transaction with the system origin: nothing to undo, and the pin
 * watcher, which ignores the system's changes, deletes no thread. Again whenever the threads or
 * the document change.
 *
 * @param input - The threads, the pins they were checked against, the board and whether the
 *   person edits.
 * @param input.threads - The board's threads.
 * @param input.checkedPinIds - The comment objects in the document when the list in hand was asked
 *   for; undefined until a list has loaded for this board.
 * @param input.connection - The live board.
 * @param input.canEdit - Whether the person may edit the board.
 */
export function useCleanDocumentPins(input: {
  readonly threads: readonly Thread[];
  readonly checkedPinIds: ReadonlySet<string> | undefined;
  readonly connection: Pick<BoardConnection, 'store'> | undefined;
  readonly canEdit: boolean;
}): void {
  const { threads, checkedPinIds, connection, canEdit } = input;
  useEffect(() => {
    if (!canEdit || checkedPinIds === undefined || connection === undefined) return undefined;
    const { store } = connection;
    // While a stepped run holds the store, the cleanup waits until it is idle.
    const clean = (): void => {
      whenStoreIdle(store, () => {
        const ids = stalePinIdsOf(store.read(), threads, checkedPinIds);
        if (ids.length === 0) return;
        const environment = { clock: Date.now, createId: () => crypto.randomUUID() as ObjectId };
        runCommand(store, SYSTEM_ORIGIN, deleteObjectsCommand, { ids }, environment);
      });
    };
    clean();
    let isActive = true;
    // A listener must not write while the transaction it hears is running: clean right after.
    const unsubscribe = store.subscribe((changes) => {
      if (changes.origin.kind === 'system') return;
      queueMicrotask(() => {
        if (isActive) clean();
      });
    });
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [threads, checkedPinIds, connection, canEdit]);
}
