import { z } from 'zod';

import { objectIdSchema, type BoardObject, type FrameObject, type ObjectId } from '@canvas/schema';

import { checkObject, lookUpNamed, movabilityErrors, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command, type CommandContext } from './command.js';
import { newFrameObjectSchema } from './new-object-schema.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { pageOfObject } from './pages/page-support.js';
import { planReparents, type ReparentRequest } from './reparent.js';
import { nextZAbove } from './z-placement.js';

/** Validates the input of {@link createFrameCommand}. */
export const createFrameInputSchema = z
  .strictObject({
    /** The frame to create, in its parent's frame, as `createObject` takes a frame. */
    frame: newFrameObjectSchema.describe(
      "The frame to create, placed in its parent's frame, as createObject takes a frame.",
    ),
    /** The objects the new frame takes in; each keeps where it is on the board. */
    childIds: z
      .array(objectIdSchema)
      .default([])
      .describe(
        'The objects the new frame takes in, each keeping where it is on the board; their stacking order is kept.',
      ),
  })
  .describe('Creates a frame and moves objects into it, as one step.');

/** The input of {@link createFrameCommand}, after parsing. */
type CreateFrameInput = z.output<typeof createFrameInputSchema>;

/** What {@link createFrameCommand} returns. */
export interface CreateFrameResult {
  /** The new frame's id. */
  readonly id: ObjectId;
  /** The objects it took in, in input order. */
  readonly childIds: readonly ObjectId[];
}

/** What {@link createFrameCommand} will write. */
export interface CreateFramePlan {
  /** The new frame, whole and validated. */
  readonly frame: FrameObject;
  /** Each adopted object's new parent, placement and stacking key, in input order. */
  readonly patches: readonly PlannedPatch[];
}

/**
 * The board with the new frame laid over it, so the reparenting rules find the parent they
 * convert into; its reverse indexes are the board's, where the new frame has no children yet.
 *
 * @param board - The board before the command.
 * @param frame - The new frame.
 * @returns The reader.
 */
function withNewFrame(board: BoardReader, frame: FrameObject): BoardReader {
  return {
    get: (id) => (id === frame.id ? frame : board.get(id)),
    references: board.references,
  };
}

/**
 * Builds and checks the new frame as `createObject` does: its id (given or generated), a key
 * on top of its parent's children, the origin's principal and the command's time.
 *
 * @param context - The command's context.
 * @param input - The parsed input.
 * @param errors - Where to add the problems.
 * @returns The frame, or `undefined` when it cannot be created.
 */
function newFrameOf(
  context: CommandContext,
  input: CreateFrameInput,
  errors: CommandError[],
): FrameObject | undefined {
  const { board, origin, now } = context;
  const id = input.frame.id ?? context.createId();
  if (board.get(id) !== undefined) {
    errors.push(commandError('duplicate-id', id, ['frame', 'id'], `"${id}" is already in use`));
  }
  const z = input.frame.z ?? nextZAbove(board, input.frame.parentId, id, ['frame', 'z'], errors);
  if (z === undefined) return undefined;
  // At the root, the frame goes on its children's page unless given one.
  const [firstChild] = input.childIds;
  const childPage =
    firstChild === undefined ? undefined : pageOfObject(board, board.get(firstChild));
  const pageId = input.frame.parentId === null ? (input.frame.pageId ?? childPage ?? null) : null;
  const candidate = {
    ...input.frame,
    id,
    z,
    pageId,
    createdBy: origin.principalId,
    createdAt: now,
  };
  const frame = checkObject(board, { ...candidate, updatedAt: now }, errors);
  if (frame === undefined) return undefined;
  errors.push(...referenceErrors(board, [frame]));
  return frame.type === 'frame' ? frame : undefined;
}

/** The `createFrame` command's type. */
export type CreateFrameCommand = Command<
  typeof createFrameInputSchema,
  CreateFramePlan,
  CreateFrameResult
>;

/**
 * `createFrame`: creates a frame and takes objects
 * into it in one transaction, so drawing a frame over objects is one undo step. The frame is
 * created as `createObject` creates one (id, key on top of its parent's children, stamps); each
 * listed object then goes into it as a reparenting move does: its position and
 * rotation are converted into the frame's, so nothing moves on the board, and the adopted
 * objects go on top of each other in the order the board painted them. Refused, writing
 * nothing, when the frame could not be created, or when a listed object is missing, listed
 * twice, locked, inside a group (it moves with its group), listed with one of its ancestors, or
 * the frame's own parent or one of its ancestors.
 */
export const createFrameCommand: CreateFrameCommand = {
  name: 'createFrame',
  description:
    'Creates a frame and moves the listed objects into it, keeping them where they are on the board, as one step.',
  input: createFrameInputSchema,
  validate(context, input) {
    const { board } = context;
    const errors: CommandError[] = [];
    const frame = newFrameOf(context, input, errors);
    const { named, errors: lookUpErrors } = lookUpNamed(
      board,
      input.childIds,
      (id) => id,
      (index) => ['childIds', index],
    );
    errors.push(...lookUpErrors);
    if (frame === undefined || errors.length > 0) return reject(errors);
    const ids = new Set(named.map(({ object }) => object.id));
    const requests: ReparentRequest[] = named.map(({ object, path }) => {
      errors.push(...movabilityErrors(board, object, path, ids));
      return { object, position: { x: object.x, y: object.y }, parentId: frame.id, path };
    });
    if (errors.length > 0) return reject(errors);
    const reader = withNewFrame(board, frame);
    const reparents = planReparents(reader, requests, ids, errors);
    const patches = named.flatMap(({ object }): PlannedPatch[] => {
      const patch = reparents.get(object.id);
      if (patch === undefined) return [];
      const checked: BoardObject | undefined = checkObject(board, { ...object, ...patch }, errors);
      return checked === undefined ? [] : [{ id: object.id, patch }];
    });
    return errors.length > 0 ? reject(errors) : accept({ frame, patches });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.frame);
    return { id: plan.frame.id, childIds: applyPatches(transaction, plan.patches) };
  },
};
