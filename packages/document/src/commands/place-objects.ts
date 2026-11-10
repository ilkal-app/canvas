import { z } from 'zod';

import {
  compareSiblings,
  firstPageIdOf,
  objectIdSchema,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, hasListedAncestor, lookUpNamed, pagesOf } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { pageOfObject } from './pages/page-support.js';
import { comparePaintOrder } from './paint-order.js';
import { placementIn } from './reparent.js';
import { SubBoard } from './sub-board.js';
import { zKeysBelow } from './z-placement.js';

/** Validates the input of {@link placeObjectsCommand}. */
export const placeObjectsInputSchema = z
  .strictObject({
    /** The objects to place; at least one, each listed once. */
    ids: z.array(objectIdSchema).min(1).describe('The objects to place, each listed once.'),
    /** The frame, group or main they end up in, or `null` for the board root. */
    parentId: objectIdSchema
      .nullable()
      .describe('The frame, group or main the objects end up in, or null for the board root.'),
    /** The child of that parent they go directly below; omitted puts them on top. */
    belowId: objectIdSchema
      .optional()
      .describe(
        'A child of that parent, not one of the objects, that they go directly below; omitted puts them on top of its stack.',
      ),
  })
  .describe(
    'Places objects in a parent’s stacking order, directly below a sibling or on top, taking them into that frame, group or main if they are elsewhere; they stay where they are on the board.',
  );

/** What {@link placeObjectsCommand} returns. */
export interface PlaceObjectsResult {
  /** The objects written, in the order they now stack, bottom first; empty when already placed. */
  readonly movedIds: readonly ObjectId[];
  /** Those among them that changed parent, in the same order. */
  readonly reparentedIds: readonly ObjectId[];
}

/** What {@link placeObjectsCommand} will write. */
export interface PlaceObjectsPlan {
  /** Each object's new fields, bottom first. */
  readonly patches: readonly PlannedPatch[];
  /** The objects that change parent, bottom first. */
  readonly reparentedIds: readonly ObjectId[];
}

/** The input of {@link placeObjectsCommand}. */
type PlaceObjectsInput = z.output<typeof placeObjectsInputSchema>;

/**
 * Whether an object is a retired (deleted, retained) main or lies inside one: such content is
 * hidden from every view, so nothing may be placed there.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns Whether it or an ancestor is a retired main.
 */
function isInRetiredMain(board: BoardReader, object: BoardObject): boolean {
  const seen = new Set<ObjectId>();
  for (let at: BoardObject | undefined = object; at !== undefined && !seen.has(at.id);) {
    if (at.type === 'component' && at.retired) return true;
    seen.add(at.id);
    at = at.parentId === null ? undefined : board.get(at.parentId);
  }
  return false;
}

/**
 * Why the parent cannot take the objects, if it cannot: it must exist, be a frame, a group or a
 * main (a component, whose real children are edited as a frame's) and not be locked (a locked container takes nothing), be on the objects' page, and be
 * neither one of them nor inside one.
 *
 * @param board - The board before the command.
 * @param input - The command's input.
 * @param objects - The objects named.
 * @returns The refusals.
 */
function parentErrors(
  board: BoardReader,
  input: PlaceObjectsInput,
  objects: readonly BoardObject[],
): CommandError[] {
  const { parentId } = input;
  const path = ['parentId'];
  if (parentId === null) return [];
  const refuse = (code: CommandError['code'], message: string) => [
    commandError(code, parentId, path, message),
  ];
  const parent = board.get(parentId);
  if (parent === undefined) return refuse('missing-parent', `there is no object "${parentId}"`);
  if (isInRetiredMain(board, parent)) {
    return refuse('retired-main', `"${parentId}" is a deleted main or inside one`);
  }
  if (parent.type !== 'frame' && parent.type !== 'group' && parent.type !== 'component') {
    const message = `"${parentId}" is a ${parent.type}, not a frame, a group or a main`;
    return refuse('invalid-parent', message);
  }
  if (parent.locked) return refuse('locked', `"${parentId}" is locked`);
  const ids = new Set(objects.map(({ id }) => id));
  if (ids.has(parentId) || hasListedAncestor(board, parent, ids)) {
    return refuse('parent-cycle', `"${parentId}" is one of the objects or inside one`);
  }
  // Pages as they are shown: an object whose parent a peer deleted, before the reference repair
  // re-roots it, is shown on the first page (`shownPageIdOf`), not on no page.
  const firstPage = firstPageIdOf({ objects: new Map(), pages: pagesOf(board) });
  const shownPage = (object: BoardObject) => pageOfObject(board, object) ?? firstPage;
  const page = shownPage(parent);
  const elsewhere = objects.find((object) => shownPage(object) !== page);
  if (elsewhere !== undefined) {
    return refuse('cross-page', `"${parentId}" is on another page than "${elsewhere.id}"`);
  }
  return [];
}

/**
 * Why the sibling named cannot be placed below, if it cannot: it must be a child of the parent
 * and not one of the objects.
 *
 * @param board - The board before the command.
 * @param input - The command's input.
 * @returns The refusals.
 */
function siblingErrors(board: BoardReader, input: PlaceObjectsInput): CommandError[] {
  const { belowId, parentId } = input;
  if (belowId === undefined) return [];
  const path = ['belowId'];
  const sibling = board.get(belowId);
  if (sibling === undefined) {
    return [commandError('missing-object', belowId, path, `there is no object "${belowId}"`)];
  }
  if (input.ids.includes(belowId)) {
    const message = `"${belowId}" is one of the objects placed below it`;
    return [commandError('invalid-input', belowId, path, message)];
  }
  if (sibling.parentId !== parentId) {
    const message = `"${belowId}" is not a child of ${parentId === null ? 'the board root' : `"${parentId}"`}`;
    return [commandError('invalid-input', belowId, path, message)];
  }
  return [];
}

/**
 * Whether the objects already stack where the command would put them: all children of the
 * parent, with no other child between them, directly below the sibling (or on top). One pass
 * over the parent's children.
 *
 * @param board - The board before the command.
 * @param parentId - The parent.
 * @param belowId - The sibling, or `null` for the top.
 * @param objects - The objects, bottom first.
 * @returns True when nothing would change.
 */
function isInPlace(
  board: BoardReader,
  parentId: ObjectId | null,
  belowId: ObjectId | null,
  objects: readonly [BoardObject, ...BoardObject[]],
): boolean {
  const [bottom] = objects;
  const top = objects.reduce((previous, object) => object);
  if (objects.some((object) => object.parentId !== parentId)) return false;
  const moved = new Set(objects.map(({ id }) => id));
  const sibling = belowId === null ? undefined : board.get(belowId);
  const ceiling = sibling === undefined ? undefined : { id: sibling.id, z: sibling.z };
  if (ceiling !== undefined && compareSiblings(top, ceiling) > 0) return false;
  for (const childId of board.references.childrenOf(parentId)) {
    const child = moved.has(childId) || childId === belowId ? undefined : board.get(childId);
    if (child === undefined) continue;
    const key = { id: childId, z: child.z };
    const isAboveBottom = compareSiblings(key, bottom) > 0;
    const isBelowCeiling = ceiling === undefined || compareSiblings(key, ceiling) < 0;
    if (isAboveBottom && isBelowCeiling) return false;
  }
  return true;
}

/**
 * The patch of each object: its new key, and where an object changes parent, the parent and its
 * placement in the new parent's frame.
 *
 * @param frames - A board holding the objects' chains of parents and the parent's.
 * @param input - The command's input.
 * @param objects - The objects, bottom first.
 * @param keys - Their new keys, in the same order.
 * @param errors - Where to add a refusal.
 * @returns The patches, bottom first.
 */
function patchesOf(
  frames: Board,
  input: PlaceObjectsInput,
  objects: readonly BoardObject[],
  keys: readonly string[],
  errors: CommandError[],
): PlannedPatch[] {
  const { parentId } = input;
  return objects.flatMap((object, index): PlannedPatch[] => {
    const z = keys[index] ?? object.z;
    if (object.parentId === parentId) return [{ id: object.id, patch: { z } }];
    const placement = placementIn(frames, object, parentId);
    if (placement === null) {
      const path = ['ids', input.ids.indexOf(object.id)];
      const message = `the ancestors of "${object.id}" or of its new parent form a cycle`;
      errors.push(commandError('parent-cycle', object.id, path, message));
      return [];
    }
    return [{ id: object.id, patch: { parentId, ...placement, z } }];
  });
}

/**
 * `placeObjects` (the layers panel's drag and drop): places objects in a parent's
 * stacking order, directly below one of its children (`belowId`) or on top of its stack, in the
 * order the board painted them in (`comparePaintOrder`), as one transaction and one undo step.
 * An object from another parent is taken into this one (a frame, a group, a main or the root), its
 * position and rotation converted into the new parent's frame so it stays where it is on the
 * board; unlike `moveObjects`, it may leave a group. Only the moved objects' fields are
 * written, and their keys come from the neighbours' (`zKeysBelow`), so concurrent placements
 * and reorders by other editors merge. Objects already in place write nothing.
 *
 * Refused for a missing, locked or non-container parent, a parent that is one of the objects or
 * inside one, or on another page, a sibling that is not the parent's child or is one of the
 * objects, and an object listed together with one of its ancestors; a placement into a main
 * that breaks the component reference limits (an instance inside its own main) is refused by
 * `runCommand`'s component checks. Locked objects may be placed: they do not move on the board,
 * as the order commands restack them too.
 */
export const placeObjectsCommand: Command<
  typeof placeObjectsInputSchema,
  PlaceObjectsPlan,
  PlaceObjectsResult
> = {
  name: 'placeObjects',
  description:
    'Places objects directly below a sibling, or on top, in a frame, group, main or the board root; they stay where they are on the board.',
  input: placeObjectsInputSchema,
  validate(context, input) {
    const { board } = context;
    const { named, errors } = lookUpNamed(
      board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    const objects = named.map(({ object }) => object);
    const ids = new Set(objects.map(({ id }) => id));
    for (const { object, path } of named) {
      if (hasListedAncestor(board, object, ids)) {
        const message = `"${object.id}" is listed together with one of its ancestors`;
        errors.push(commandError('overlapping-selection', object.id, path, message));
      }
    }
    if (errors.length > 0) return reject(errors);
    errors.push(...parentErrors(board, input, objects), ...siblingErrors(board, input));
    if (errors.length > 0) return reject(errors);
    const subBoard = new SubBoard(board);
    for (const object of objects) subBoard.addWithAncestors(object.id);
    if (input.parentId !== null) subBoard.addWithAncestors(input.parentId);
    const frames = subBoard.toBoard();
    // The input names at least one object, and every name was found.
    const sorted = [...objects].sort((first, second) =>
      comparePaintOrder(frames, first, second),
    ) as [BoardObject, ...BoardObject[]];
    const belowId = input.belowId ?? null;
    if (isInPlace(board, input.parentId, belowId, sorted)) {
      return accept({ patches: [], reparentedIds: [] });
    }
    const order = sorted.map(({ id }) => id) as [ObjectId, ...ObjectId[]];
    const keys = zKeysBelow(board, input.parentId, belowId, ids, order, ['belowId'], errors);
    if (keys === undefined) return reject(errors);
    const patches = patchesOf(frames, input, sorted, keys, errors);
    const byId = new Map(objects.map((object) => [object.id, object]));
    for (const { id, patch } of patches) checkObject(board, { ...byId.get(id), ...patch }, errors);
    if (errors.length > 0) return reject(errors);
    const reparentedIds = sorted.flatMap(({ id, parentId }) =>
      parentId === input.parentId ? [] : [id],
    );
    return accept({ patches, reparentedIds });
  },
  apply(transaction, input, plan) {
    return { movedIds: applyPatches(transaction, plan.patches), reparentedIds: plan.reparentedIds };
  },
};
