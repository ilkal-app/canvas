import type { Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

/**
 * Builds a board without `removedIds` and with `replacements` substituted by id, sharing every
 * other object with the input.
 *
 * @param board - The board to start from; it is not modified.
 * @param removedIds - Objects to leave out.
 * @param replacements - New versions of existing objects, keyed by their `id`.
 * @returns The input board when there is nothing to change, else a new board.
 */
export function replaceObjects(
  board: Board,
  removedIds: Iterable<ObjectId>,
  replacements: readonly BoardObject[],
): Board {
  const removed = new Set(removedIds);
  if (removed.size === 0 && replacements.length === 0) return board;
  const objects = new Map(board.objects);
  for (const id of removed) objects.delete(id);
  for (const replacement of replacements) objects.set(replacement.id, replacement);
  return { objects };
}
