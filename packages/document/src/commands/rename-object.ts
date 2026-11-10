import { z } from 'zod';

import {
  MAX_OBJECT_NAME_LENGTH,
  objectIdSchema,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';

/** Validates the input of {@link renameObjectCommand}. */
export const renameObjectInputSchema = z
  .strictObject({
    /** The object. */
    id: objectIdSchema.describe('The object to rename.'),
    /** Its new layer name, up to 200 characters; empty to clear it. */
    name: z
      .string()
      .max(MAX_OBJECT_NAME_LENGTH)
      .describe(
        "Its new layer name, up to 200 characters; empty clears it (a frame's or main's name becomes empty).",
      ),
  })
  .describe("Sets an object's layer name.");

/** The outcome of {@link renameObjectCommand}. */
export interface RenameObjectResult {
  /** Whether the name changed; false when the object already had it. */
  readonly isChanged: boolean;
}

/** What {@link renameObjectCommand} writes. */
export interface RenameObjectPlan {
  /** The object. */
  readonly id: ObjectId;
  /** The name it stores; undefined to clear it. */
  readonly name: string | undefined;
  /** Whether its name changes; nothing is written when not. */
  readonly isChanged: boolean;
}

/** The command type of {@link renameObjectCommand}. */
export type RenameObjectCommand = Command<
  typeof renameObjectInputSchema,
  RenameObjectPlan,
  RenameObjectResult
>;

/**
 * The name an object stores for a requested one: a frame or main always has a name, so an empty
 * one is stored as `''`; any other object stores none.
 *
 * @param object - The object.
 * @param name - The requested name.
 * @returns The name to store, or undefined for none.
 */
function storedName(object: BoardObject, name: string): string | undefined {
  return name === '' && object.type !== 'frame' && object.type !== 'component' ? undefined : name;
}

/**
 * `renameObject`: sets any object's layer `name`, which the layers list shows and
 * `query_board` reports. An empty name clears it: a frame or main keeps an empty name, any other
 * object stores none. It writes `name` alone, in the object's `style` group, so a rename merges
 * with a concurrent move, and a concurrent restyle is last-writer-wins on the group. A locked
 * object can be renamed, as it can be restyled (lock covers position, size and rotation), as
 * `renameFrame` allows. Refused for a missing object.
 */
export const renameObjectCommand: RenameObjectCommand = {
  name: 'renameObject',
  description: "Sets any object's layer name; up to 200 characters, empty to clear it.",
  input: renameObjectInputSchema,
  validate(context, input) {
    const object = context.board.get(input.id);
    const errors: CommandError[] = [];
    if (object === undefined) {
      errors.push(
        commandError('missing-object', input.id, ['id'], `there is no object "${input.id}"`),
      );
      return reject(errors);
    }
    const name = storedName(object, input.name);
    checkObject(context.board, { ...object, name }, errors);
    if (errors.length > 0) return reject(errors);
    return accept({ id: input.id, name, isChanged: object.name !== name });
  },
  apply(transaction, input, plan) {
    if (plan.isChanged) transaction.patchObject(input.id, { name: plan.name });
    return { isChanged: plan.isChanged };
  },
};
