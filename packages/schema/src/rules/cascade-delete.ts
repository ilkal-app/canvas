import type { Board } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';

import { collectDescendantSet } from './collect-descendants.js';
import { detachedComments } from './detach-comments.js';
import { detachedConnectors, isEndAttachedTo } from './detach-connectors.js';
import { replaceObjects } from './replace-objects.js';

/**
 * What happens to a connector attached to a deleted object: `detach`
 * (the default) turns the attached end into a free point; `delete` deletes the connector.
 */
export type ConnectorDeletePolicy = 'detach' | 'delete';

/** Options for {@link cascadeDelete}. */
export interface CascadeDeleteOptions {
  /** What happens to connectors attached to deleted objects; a user setting, default `detach`. */
  readonly connectorPolicy: ConnectorDeletePolicy;
}

/** What {@link cascadeDelete} did, for the command layer to apply as one transaction. */
export interface CascadeDeleteResult {
  /** The board after the deletion. */
  readonly board: Board;
  /** Every object removed, sorted by UTF-16 code units. */
  readonly deletedIds: readonly ObjectId[];
  /** Every surviving object that changed (detached connectors, re-anchored comments), sorted. */
  readonly updatedIds: readonly ObjectId[];
}

/**
 * Deletes objects under the schema's reference rules: deleting a parent deletes its
 * children, recursively; connectors attached to a deleted object are detached (the end becomes a
 * free point where it was) or, under the `delete` policy, deleted too; comments pinned to a
 * deleted object are re-anchored to a point where the pin was. Positions are measured on the
 * board before anything is removed. Ids not on the board are ignored.
 *
 * The command layer applies the result as one transaction, so one undo restores everything,
 * and stamps `updatedAt` on the updated objects; this function has no clock.
 *
 * @param board - The board to delete from; it is not modified.
 * @param ids - The objects to delete.
 * @param options - The connector policy; defaults to `{ connectorPolicy: 'detach' }`.
 * @returns The new board and the ids of the deleted and updated objects.
 * @throws {RangeError} When a parent cycle makes a detached end's position undefined.
 */
export function cascadeDelete(
  board: Board,
  ids: Iterable<ObjectId>,
  options: CascadeDeleteOptions = { connectorPolicy: 'detach' },
): CascadeDeleteResult {
  const children = buildChildIndex(board);
  const deleted = collectDescendantSet(board, ids, children);
  if (options.connectorPolicy === 'delete') {
    const attached = [...board.objects.values()].filter(
      (object) =>
        object.type === 'connector' &&
        (isEndAttachedTo(object.from, deleted) || isEndAttachedTo(object.to, deleted)),
    );
    for (const connector of attached) deleted.add(connector.id);
  }
  const updated = [
    ...detachedConnectors(board, deleted, children),
    ...detachedComments(board, deleted),
  ];
  return {
    board: replaceObjects(board, deleted, updated),
    deletedIds: [...deleted].sort(),
    updatedIds: updated.map((object) => object.id).sort(),
  };
}
