import {
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import type { CommandContext } from './command.js';
import { planInstanceDetach } from './detach-instance.js';
import { pageOfObject } from './pages/page-support.js';
import { SubBoard } from './sub-board.js';

/** Main-retirement changes prepared before the ordinary delete cascade. */
export interface ComponentRetirement {
  /** Cascade view with retained definitions excluded. */
  readonly board: Board;
  /** Roots still subject to ordinary deletion. */
  readonly ids: readonly ObjectId[];
  /** Retired definitions and detached materializations. */
  readonly updated: readonly BoardObject[];
  /** Retained main identities. */
  readonly retiredIds: readonly ObjectId[];
  /** Instance identities changed to frames. */
  readonly detachedIds: readonly ObjectId[];
  /** Each detached instance's new children, by new id, to the main child each copies. */
  readonly copiedFrom: Readonly<Record<ObjectId, ObjectId>>;
}

/**
 * Retains deleted definitions and detaches known surviving instances before cascading deletion.
 *
 * @param context - Command context with the id generator used for materialized children.
 * @param board - Cascade snapshot, including ancestors and attached objects.
 * @param ids - Requested deletion roots.
 * @param errors - Refusals to append without writing anything.
 * @returns A cascade view and the retirement writes.
 */
export function planComponentRetirement(
  context: CommandContext,
  board: Board,
  ids: readonly ObjectId[],
  errors: CommandError[],
): ComponentRetirement {
  const subtree = new SubBoard(context.board);
  const deleting = new Set(ids.flatMap((id) => subtree.addSubtree(id)));
  const mains = [...deleting].flatMap((id) => {
    const object = context.board.get(id);
    return object?.type === 'component' ? [object] : [];
  });
  const keptTree = new SubBoard(context.board);
  const retained = new Set(mains.flatMap((main) => keptTree.addSubtree(main.id)));
  const objects = new Map(board.objects);
  for (const id of retained) objects.delete(id);
  const updated: BoardObject[] = [];
  const detachedIds: ObjectId[] = [];
  const copiedFrom: Record<ObjectId, ObjectId> = {};
  const detached = new Set<ObjectId>();
  const retiring = new Set(mains.map((main) => main.id));
  for (const main of mains) {
    const isParentDeleted =
      main.parentId !== null && deleting.has(main.parentId) && !retained.has(main.parentId);
    const world = isParentDeleted ? objectToBoardTransform(board, main) : undefined;
    updated.push(
      world === undefined
        ? { ...main, retired: true }
        : {
            ...main,
            retired: true,
            parentId: null,
            pageId: pageOfObject(context.board, main) ?? null,
            x: world.x,
            y: world.y,
            rotation: Math.atan2(world.sin, world.cos),
          },
    );
    for (const id of context.board.references.instancesOf(main.id)) {
      if (detached.has(id) || (deleting.has(id) && !retained.has(id))) continue;
      const instance = context.board.get(id);
      if (instance?.type !== 'instance') continue;
      const plan = planInstanceDetach(context, instance, errors, retiring);
      if (plan === undefined) continue;
      detached.add(id);
      detachedIds.push(id);
      updated.push(plan.frame, ...plan.children);
      for (const [path, copy] of Object.entries(plan.idMap))
        copiedFrom[copy] = (path.split('/').at(-1) ?? path) as ObjectId;
    }
  }
  const generated = new Set<ObjectId>();
  for (const object of updated) {
    if (generated.has(object.id))
      errors.push(
        commandError(
          'duplicate-id',
          object.id,
          [],
          'Materializations require distinct generated child ids.',
        ),
      );
    generated.add(object.id);
  }
  return {
    board: { ...board, objects },
    ids: ids.filter((id) => !retained.has(id)),
    updated,
    retiredIds: mains.map((main) => main.id).sort(),
    detachedIds: detachedIds.sort(),
    copiedFrom,
  };
}
