import { z } from 'zod';

import { frameObjectSchema, objectIdSchema, type ObjectId } from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';

/** Validates the input of {@link renameFrameCommand}. */
export const renameFrameInputSchema = z
  .strictObject({
    /** The frame. */
    id: objectIdSchema.describe('The frame to rename.'),
    /** Its new name, up to 200 characters. */
    name: frameObjectSchema.shape.name,
  })
  .describe("Sets a frame's name.");

/** What {@link renameFrameCommand} returns. */
export interface RenameFrameResult {
  /** Whether the name changed; false when the frame already had it. */
  readonly isChanged: boolean;
}

/** What {@link renameFrameCommand} will write. */
export interface RenameFramePlan {
  /** The frame. */
  readonly id: ObjectId;
  /** Whether its name changes; nothing is written when not. */
  readonly isChanged: boolean;
}

/** The `renameFrame` command's type. */
export type RenameFrameCommand = Command<
  typeof renameFrameInputSchema,
  RenameFramePlan,
  RenameFrameResult
>;

/**
 * `renameFrame`: sets a frame's `name`, the label
 * shown in its title band. It writes `name` alone, in the frame's `style` group, so a rename
 * merges with a concurrent move, and a concurrent restyle is last-writer-wins on the group. Any
 * object's name: `renameObject`. A locked frame can be renamed, as it can be restyled (lock covers
 * position, size and rotation). Refused for a missing object and for one that is not a frame.
 */
export const renameFrameCommand: RenameFrameCommand = {
  name: 'renameFrame',
  description: "Sets a frame's name, shown above it; up to 200 characters.",
  input: renameFrameInputSchema,
  validate(context, input) {
    const object = context.board.get(input.id);
    const errors: CommandError[] = [];
    if (object === undefined) {
      errors.push(
        commandError('missing-object', input.id, ['id'], `there is no object "${input.id}"`),
      );
    } else if (object.type !== 'frame' && object.type !== 'component') {
      const message = `"${input.id}" is a ${object.type}, not a frame`;
      errors.push(commandError('invalid-input', input.id, ['id'], message));
    } else {
      checkObject(context.board, { ...object, name: input.name }, errors);
    }
    if (errors.length > 0) return reject(errors);
    return accept({
      id: input.id,
      isChanged:
        (object?.type === 'frame' || object?.type === 'component') && object.name !== input.name,
    });
  },
  apply(transaction, input, plan) {
    if (plan.isChanged) transaction.patchObject(plan.id, { name: input.name });
    return { isChanged: plan.isChanged };
  },
};
