import { objectToBoardTransform, type Board, type ObjectId, type Point } from '@canvas/schema';

import type { NewObject } from '../commands/new-object-schema.js';

import { copySelection } from './copy-selection.js';
import { inParentFrame, planPaste } from './paste-plan.js';

/** What a duplicate creates, and where. */
export interface DuplicatePlan {
  /** The objects as `createObjects` lists them. */
  readonly objects: NewObject[];
  /** The parent of the top-level duplicates: the originals' shared parent, or the root. */
  readonly parentId: ObjectId | null;
}

/**
 * Plans a duplicate (mod+d): a copy of the selection pasted at once,
 * `PASTE_OFFSET` (16 world units) from the originals, without the clipboard. When the copied
 * roots all come from one group or frame, the duplicates go on top of that parent, re-expressed
 * in its frame (`inParentFrame`); otherwise at the board root. Pure.
 *
 * @param board - The board.
 * @param ids - The selected ids.
 * @param offset - How far the duplicates land from the originals, board units; `PASTE_OFFSET`
 *   on both axes by default (an agent may choose another).
 * @returns The plan, or `undefined` when nothing selected can be copied.
 */
export function planDuplicate(
  board: Board,
  ids: readonly ObjectId[],
  offset?: Point,
): DuplicatePlan | undefined {
  const copied = copySelection(board, ids);
  if (copied === undefined) return undefined;
  const planned = planPaste(copied, undefined, offset);
  const parentIds = new Set(
    planned.flatMap((object) =>
      object.parentId === null && object.id !== undefined
        ? [board.objects.get(object.id)?.parentId ?? null]
        : [],
    ),
  );
  const [parentId = null] = parentIds.size === 1 ? parentIds : [];
  const parent = parentId === null ? undefined : board.objects.get(parentId);
  return parent === undefined
    ? { objects: planned, parentId: null }
    : {
        objects: inParentFrame(planned, objectToBoardTransform(board, parent)),
        parentId: parent.id,
      };
}
