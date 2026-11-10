import { z } from 'zod';

import { findFreehandIssues, type BoardObject, type ObjectId } from '@canvas/schema';

import { checkObject, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { newObjectSchema } from './new-object-schema.js';
import { nextZAbove } from './z-placement.js';

/** Validates the input of {@link createObjectCommand}. */
export const createObjectInputSchema = z
  .strictObject({
    /** The object to create. */
    object: newObjectSchema.describe('The object to create.'),
  })
  .superRefine(({ object }, context) => {
    // A stroke's point rule reads two fields, so the union cannot carry it: checked
    // here, so a bad stroke is refused as input, at its field.
    if (object.type !== 'freehand') return;
    for (const message of findFreehandIssues(object.points, object.pressures)) {
      context.addIssue({ code: 'custom', path: ['object', 'points'], message, input: object });
    }
  })
  .describe('Creates one object of any type.');

/** What {@link createObjectCommand} returns. */
export interface CreateObjectResult {
  /** The new object's id. */
  readonly id: ObjectId;
}

/** The object {@link createObjectCommand} will write. */
export interface CreateObjectPlan {
  /** The new object, whole and validated. */
  readonly object: BoardObject;
}

/**
 * `createObject`: creates one object of any type. The command fills in
 * the id (unless given), `z` (on top of its siblings, unless given), `createdBy` (the origin's
 * principal) and `createdAt` = `updatedAt` (the command's time). Refused when the id is in use,
 * or when the parent, a connector end or a comment anchor is missing or of a kind that cannot
 * be referenced.
 */
export const createObjectCommand: Command<
  typeof createObjectInputSchema,
  CreateObjectPlan,
  CreateObjectResult
> = {
  name: 'createObject',
  description: 'Creates one object of any type; the id, stacking key and timestamps are filled in.',
  input: createObjectInputSchema,
  validate(context, input) {
    const { board, origin, now } = context;
    const id = input.object.id ?? context.createId();
    const errors: CommandError[] = [];
    if (board.get(id) !== undefined) {
      errors.push(commandError('duplicate-id', id, ['object', 'id'], `"${id}" is already in use`));
    }
    const z =
      input.object.z ?? nextZAbove(board, input.object.parentId, id, ['object', 'z'], errors);
    if (z === undefined) return reject(errors);
    const object = checkObject(
      context.board,
      {
        ...input.object,
        id,
        z,
        createdBy: origin.principalId,
        createdAt: now,
        updatedAt: now,
      },
      errors,
    );
    if (object !== undefined) errors.push(...referenceErrors(board, [object]));
    return errors.length > 0 || object === undefined ? reject(errors) : accept({ object });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.object);
    return { id: plan.object.id };
  },
};
