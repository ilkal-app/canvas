import { z } from 'zod';

import {
  applyTransform,
  buildChildIndex,
  finiteCoordinate,
  localBounds,
  objectIdSchema,
  placementTransform,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { pageOfObject } from './pages/page-support.js';
import { SubBoard } from './sub-board.js';
import { zKeysAbove } from './z-placement.js';

/** Validates the input of {@link groupCommand}. */
export const groupInputSchema = z
  .strictObject({
    /** The objects to group; they must share one parent. */
    ids: z
      .array(objectIdSchema)
      .min(1)
      .describe('The objects to group; they must share one parent.'),
    /** The new group's id; generated when omitted. */
    groupId: objectIdSchema.optional().describe("The new group's id; generated when omitted."),
  })
  .describe('Groups objects that share a parent, keeping where they are on the board.');

/** What {@link groupCommand} returns. */
export interface GroupResult {
  /** The new group's id. */
  readonly groupId: ObjectId;
}

/** What {@link groupCommand} will write. */
export interface GroupPlan {
  /** The new group, whole and validated. */
  readonly group: BoardObject;
  /** The members, moved into the group. */
  readonly members: readonly PlannedPatch[];
}

/**
 * The top-left corner of the members' bounds in their parent's frame: the new group's origin.
 * Bounds come from the schema's `localBounds` (a member group's are derived from its own
 * children); connectors and comments are skipped as a group's derived bounds skip them, unless
 * there is nothing else, when their origins are used.
 *
 * @param board - The board before the command.
 * @param members - The members.
 * @returns The origin, world units in the parent's frame.
 */
function boundsOrigin(board: BoardReader, members: readonly BoardObject[]): Point {
  const subBoard = new SubBoard(board);
  for (const member of members) subBoard.addSubtree(member.id);
  const subtrees = subBoard.toBoard();
  const children = buildChildIndex(subtrees);
  const measured = members.filter(
    (member) => member.type !== 'connector' && member.type !== 'comment',
  );
  const points = measured.flatMap((member) => {
    const rect = localBounds(subtrees, member, children);
    const toParent = placementTransform(member.x, member.y, member.rotation);
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    return [
      { x: rect.x, y: rect.y },
      { x: right, y: rect.y },
      { x: right, y: bottom },
      { x: rect.x, y: bottom },
    ].map((corner) => applyTransform(toParent, corner));
  });
  const corners = points.length > 0 ? points : members.map(({ x, y }) => ({ x, y }));
  // Members stored far away can sum to an infinity; only what is not finite is clamped.
  return {
    x: finiteCoordinate(
      corners.reduce((left, point) => Math.min(left, point.x), Number.POSITIVE_INFINITY),
    ),
    y: finiteCoordinate(
      corners.reduce((top, point) => Math.min(top, point.y), Number.POSITIVE_INFINITY),
    ),
  };
}

/**
 * `group`: puts objects that share a parent into a new group, keeping
 * where they are on the board. The group is created in their parent (on the root when that
 * parent is no longer on the board, where they are drawn), unrotated, with its origin
 * at the top-left of their bounds; its own bounds are derived from them and never stored.
 * Each member's position becomes relative to the group. The group is stacked where the
 * topmost member was, with a fresh key directly above that member's key and below the next
 * sibling's, and the members keep their keys, so the stack looks the same.
 *
 * Why a fresh key rather than the member's own: two clients grouping selections with the same
 * topmost member at once would otherwise give two sibling groups one key, and every later
 * placement between them would be refused (`unorderable-neighbours`). The fresh key
 * ends in the group's tag, like every generated key, so the two groups' keys differ.
 */
export const groupCommand: Command<typeof groupInputSchema, GroupPlan, GroupResult> = {
  name: 'group',
  isPlacePreserving: true,
  description: 'Groups objects that share a parent, keeping where they are on the board.',
  input: groupInputSchema,
  validate(context, input) {
    const { board, now } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    const members = named.map(({ object }) => object);
    const parentIds = new Set(members.map((member) => member.parentId));
    const pageIds = new Set(members.map((member) => pageOfObject(board, member)));
    if (parentIds.size > 1 || pageIds.size > 1) {
      errors.push(
        commandError('mixed-parents', null, ['ids'], 'the objects have different parents'),
      );
    }
    const groupId = input.groupId ?? context.createId();
    if (board.get(groupId) !== undefined) {
      errors.push(
        commandError('duplicate-id', groupId, ['groupId'], `"${groupId}" is already in use`),
      );
    }
    const [first] = members;
    if (errors.length > 0 || first === undefined) return reject(errors);
    // Objects whose parent a peer deleted, before the reference repair re-roots them, are drawn on
    // the root, so their group is made there.
    const parentId =
      first.parentId !== null && board.get(first.parentId) === undefined ? null : first.parentId;
    const origin = boundsOrigin(board, members);
    const checkErrors: CommandError[] = [];
    const topmost = members.reduce((top, member) => (member.z > top ? member.z : top), first.z);
    const [z] = zKeysAbove(board, parentId, topmost, null, [groupId], ['ids'], checkErrors) ?? [];
    if (z === undefined) return reject(checkErrors);
    const group = checkObject(
      context.board,
      {
        id: groupId,
        type: 'group',
        parentId,
        pageId: parentId === null ? (pageOfObject(board, first) ?? null) : null,
        ...origin,
        rotation: 0,
        z,
        locked: false,
        createdBy: context.origin.principalId,
        createdAt: now,
        updatedAt: now,
      },
      checkErrors,
    );
    const patches = members.map((member) => {
      const patch = {
        parentId: groupId,
        x: finiteCoordinate(member.x - origin.x),
        y: finiteCoordinate(member.y - origin.y),
      };
      checkObject(context.board, { ...member, ...patch }, checkErrors);
      return { id: member.id, patch };
    });
    if (checkErrors.length > 0 || group === undefined) return reject(checkErrors);
    return accept({ group, members: patches });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.group);
    applyPatches(transaction, plan.members);
    return { groupId: plan.group.id };
  },
};
