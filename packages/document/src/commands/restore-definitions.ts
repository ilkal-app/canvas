import { objectToBoardTransform, type BoardObject, type ObjectId } from '@canvas/schema';

import type { BoardSnapshot } from '../store/document-store.js';

import type { BoardReader } from './command.js';
import { pageOfObject } from './pages/page-support.js';
import { SubBoard } from './sub-board.js';

/**
 * Retains definitions absent from a historical snapshot for concurrently placed instances.
 * Members present in the snapshot are restored normally, including their former parent.
 *
 * @param board - Current indexed board.
 * @param current - Current snapshot, for world placement.
 * @param removed - Proposed physical removals; retained ids are removed from this set.
 * @returns Retirement and re-rooting writes, without historical clock replay.
 */
export function restoreDefinitions(
  board: BoardReader,
  current: BoardSnapshot,
  removed: Set<ObjectId>,
): BoardObject[] {
  const mains = [...removed].flatMap((id) => {
    const object = board.get(id);
    return object?.type === 'component' ? [object] : [];
  });
  const subtree = new SubBoard(board);
  const retained = new Set(mains.flatMap((main) => subtree.addSubtree(main.id)));
  for (const id of retained) removed.delete(id);
  return mains.flatMap((main) => {
    const shouldReroot = main.parentId !== null && removed.has(main.parentId);
    if (main.retired && !shouldReroot) return [];
    if (!shouldReroot) return [{ ...main, retired: true }];
    const world = objectToBoardTransform(current, main);
    return [
      {
        ...main,
        retired: true,
        parentId: null,
        pageId: pageOfObject(board, main) ?? null,
        x: world.x,
        y: world.y,
        rotation: Math.atan2(world.sin, world.cos),
      },
    ];
  });
}
