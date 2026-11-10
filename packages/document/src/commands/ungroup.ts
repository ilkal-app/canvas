import { z } from 'zod';

import {
  applyTransform,
  detachCommentsFrom,
  detachConnectorsFrom,
  finiteCoordinate,
  objectIdSchema,
  placementTransform,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, hasListedAncestor, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { normalizeAngle } from './normalize-angle.js';
import { SubBoard } from './sub-board.js';
import { unlessParentCycle } from './world-frame.js';
import { zKeysAbove } from './z-placement.js';

/** Validates the input of {@link ungroupCommand}. */
export const ungroupInputSchema = z
  .strictObject({
    /** The groups to dissolve. */
    ids: z.array(objectIdSchema).min(1).describe('The groups to dissolve.'),
  })
  .describe("Dissolves groups, moving their children to the group's parent where they are.");

/** What {@link ungroupCommand} returns. */
export interface UngroupResult {
  /** The children moved out of the groups, sorted. */
  readonly releasedIds: readonly ObjectId[];
}

/** What {@link ungroupCommand} will write. */
export interface UngroupPlan {
  /** The groups to delete. */
  readonly groupIds: readonly ObjectId[];
  /** The released children, and connectors and comments detached from the groups. */
  readonly updated: readonly BoardObject[];
  /** The released children, sorted. */
  readonly releasedIds: readonly ObjectId[];
}

/**
 * The connectors and comments attached to the groups, detached as deleting the groups would
 * detach them, measured while the groups still hold their children.
 *
 * @param board - The board before the command.
 * @param groups - The groups.
 * @returns The detached objects by id, or `null` when a parent cycle leaves a position undefined.
 */
function detachFromGroups(
  board: BoardReader,
  groups: readonly BoardObject[],
): Map<ObjectId, BoardObject> | null {
  const subBoard = new SubBoard(board);
  const groupIds = groups.map((group) => group.id);
  const attached = groupIds.flatMap((id) => [
    ...board.references.connectorsAttachedTo(id),
    ...board.references.commentsAnchoredTo(id),
  ]);
  for (const id of groupIds) subBoard.addSubtree(id);
  for (const id of [...groupIds, ...attached]) subBoard.addWithAncestors(id);
  const before = subBoard.toBoard();
  const after = unlessParentCycle(() =>
    detachCommentsFrom(detachConnectorsFrom(before, groupIds), groupIds),
  );
  if (after === null) return null;
  const attachedIds = new Set(attached);
  return new Map(
    [...after.objects.values()]
      .filter((object) => attachedIds.has(object.id) && object !== before.objects.get(object.id))
      .map((object) => [object.id, object]),
  );
}

/**
 * Moves one group's children into the group's parent, keeping where they are on the board and
 * where they are in the stack: the group's placement is composed into each child's, and the
 * children take keys at the group's stacking position, in their order.
 *
 * @param board - The board before the command.
 * @param group - The group.
 * @param detached - Detached versions of attached objects, used as the child's starting point.
 * @param path - The input path naming the group, for errors.
 * @param errors - Where to add the refusal when no stacking key fits for the children.
 * @returns The released children; none when no key fits.
 */
function releaseChildren(
  board: BoardReader,
  group: BoardObject,
  detached: ReadonlyMap<ObjectId, BoardObject>,
  path: readonly (string | number)[],
  errors: CommandError[],
): BoardObject[] {
  const children = [...board.references.childrenOf(group.id)]
    .flatMap((id) => detached.get(id) ?? board.get(id) ?? [])
    .sort((first, second) =>
      first.z === second.z ? (first.id < second.id ? -1 : 1) : first.z < second.z ? -1 : 1,
    );
  const keys = zKeysAbove(
    board,
    group.parentId,
    group.z,
    group.id,
    children.map((child) => child.id),
    path,
    errors,
  );
  if (keys === undefined) return [];
  const toParent = placementTransform(group.x, group.y, group.rotation);
  return children.map((child, index) => {
    const placed = applyTransform(toParent, { x: child.x, y: child.y });
    return {
      ...child,
      x: finiteCoordinate(placed.x),
      y: finiteCoordinate(placed.y),
      parentId: group.parentId,
      rotation: normalizeAngle(group.rotation + child.rotation),
      z: keys[index] ?? child.z,
    };
  });
}

/**
 * `ungroup`: moves each group's children into
 * the group's parent, keeping where they are on the board and in the stack, then deletes the
 * group. Connectors attached to a group are detached where they were, and comments pinned to it
 * become point pins, as deleting it would do. Refused for anything but a group, and for a group
 * listed together with one of its ancestors.
 */
export const ungroupCommand: Command<typeof ungroupInputSchema, UngroupPlan, UngroupResult> = {
  name: 'ungroup',
  isPlacePreserving: true,
  description: "Dissolves groups, moving their children to the group's parent where they are.",
  input: ungroupInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    const ids = new Set(named.map(({ object }) => object.id));
    for (const { object, path } of named) {
      if (object.type !== 'group') {
        errors.push(
          commandError('unsupported-type', object.id, path, `a ${object.type} is not a group`),
        );
      } else if (hasListedAncestor(board, object, ids)) {
        const message = `"${object.id}" is listed together with one of its ancestors`;
        errors.push(commandError('overlapping-selection', object.id, path, message));
      }
    }
    if (errors.length > 0) return reject(errors);
    const groups = named.map(({ object }) => object);
    const detached = detachFromGroups(board, groups);
    if (detached === null) {
      return reject([
        commandError('parent-cycle', null, ['ids'], 'the groups sit on a parent cycle'),
      ]);
    }
    const placementErrors: CommandError[] = [];
    const released = named.flatMap(({ object, path }) =>
      releaseChildren(board, object, detached, path, placementErrors),
    );
    if (placementErrors.length > 0) return reject(placementErrors);
    const releasedIds = new Set(released.map((child) => child.id));
    const otherDetached = [...detached.values()].filter((object) => !releasedIds.has(object.id));
    const checkErrors: CommandError[] = [];
    const updated = [...released, ...otherDetached].flatMap(
      (object) => checkObject(context.board, object, checkErrors) ?? [],
    );
    if (checkErrors.length > 0) return reject(checkErrors);
    return accept({ groupIds: [...ids], updated, releasedIds: [...releasedIds].sort() });
  },
  apply(transaction, input, plan) {
    for (const object of plan.updated) transaction.setObject(object);
    for (const id of plan.groupIds) transaction.deleteObject(id);
    return { releasedIds: plan.releasedIds };
  },
};
