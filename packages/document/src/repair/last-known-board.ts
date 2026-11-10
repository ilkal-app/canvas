import type { BoardObject, ObjectId } from '@canvas/schema';

import type { BoardReader } from '../commands/command.js';
import type { BoardReferences } from '../store/reference-index.js';

import type { LastKnownObjects } from './last-known-objects.js';

/**
 * A board with its removed objects still in place: every lookup reads the board first and
 * falls back to the objects' last known state, and a removed parent's children include those
 * removed with it. The reference repair measures on it where a removed target or parent was, so
 * a detached end, a re-pinned comment or a re-parented child stays where it was on the board.
 * Reads only; the other reverse indexes are the board's own.
 */
export class LastKnownBoard implements BoardReader {
  readonly #board: BoardReader;
  readonly #lastKnown: LastKnownObjects;
  /** The board's indexes, with removed parents' remembered children added. */
  readonly references: BoardReferences;

  /**
   * Lays remembered objects under a board.
   *
   * @param board - The board as it is (or was, before an undo step).
   * @param lastKnown - The store's memory of removed objects.
   */
  constructor(board: BoardReader, lastKnown: LastKnownObjects) {
    this.#board = board;
    this.#lastKnown = lastKnown;
    const { references } = board;
    this.references = Object.freeze({
      childrenOf: (parentId: ObjectId | null): ReadonlySet<ObjectId> => {
        const onBoard = references.childrenOf(parentId);
        if (parentId === null || board.get(parentId) !== undefined) return onBoard;
        const remembered = lastKnown.childrenOf(parentId);
        return remembered.length === 0 ? onBoard : new Set([...onBoard, ...remembered]);
      },
      topChildOf: (parentId: ObjectId | null) => references.topChildOf(parentId),
      connectorsAttachedTo: (objectId: ObjectId) => references.connectorsAttachedTo(objectId),
      instancesOf: (mainId: ObjectId) => references.instancesOf(mainId),
      commentsAnchoredTo: (objectId: ObjectId) => references.commentsAnchoredTo(objectId),
    });
  }

  /**
   * An object on the board, or else as it was last seen.
   *
   * @param id - The object id.
   * @returns The object, or `undefined` when it is neither on the board nor remembered.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.#board.get(id) ?? this.#lastKnown.get(id);
  }
}
