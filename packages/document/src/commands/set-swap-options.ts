import { z } from 'zod';

import { instanceObjectSchema, objectIdSchema, type ObjectId } from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';

/** Validates the input of {@link setSwapOptionsCommand}. */
export const setSwapOptionsInputSchema = z
  .strictObject({
    /** The slot: an instance, usually inside a main. */
    id: objectIdSchema.describe('The instance (a slot inside a main) whose swap options to set.'),
    /** The mains it may be swapped to, or `null` to allow any live main. */
    options: instanceObjectSchema.shape.swapOptions
      .unwrap()
      .nullable()
      .describe(
        'The mains this slot may be swapped to, 1 to 64 distinct live component ids; null allows any.',
      ),
  })
  .describe('Sets or clears the mains a slot may be swapped to.');

/** What {@link setSwapOptionsCommand} will write. */
export interface SetSwapOptionsPlan {
  /** The instance. */
  readonly id: ObjectId;
  /** Its new swap options; `undefined` removes them. */
  readonly swapOptions: readonly ObjectId[] | undefined;
}

/** What {@link setSwapOptionsCommand} returns. */
export interface SetSwapOptionsResult {
  /** The instance written. */
  readonly id: ObjectId;
}

/**
 * `setSwapOptions`: sets the mains a slot (an instance inside a main) may be swapped
 * to, or with `null` removes the list so any live main may be swapped in. Each option must be a
 * live component (`invalid-input`); anything but an instance is refused `unsupported-type`.
 * It writes the slot alone, so an agent editing a slot under someone else's main is refused
 * `not-own-main`, like any edit of that main. Swaps already stored are never rewritten: the
 * list binds later swap commands, not reading.
 */
export const setSwapOptionsCommand: Command<
  typeof setSwapOptionsInputSchema,
  SetSwapOptionsPlan,
  SetSwapOptionsResult
> = {
  name: 'setSwapOptions',
  description:
    'Sets the mains a nested instance (a slot in a main) may be swapped to, or clears the list with null.',
  input: setSwapOptionsInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      [input.id],
      (id) => id,
      () => ['id'],
    );
    const object = named[0]?.object;
    if (object === undefined) return reject(errors);
    if (object.type !== 'instance')
      return reject([
        commandError('unsupported-type', object.id, ['id'], 'An instance is required.'),
      ]);
    input.options?.forEach((id, index) => {
      const main = context.board.get(id);
      if (main?.type !== 'component' || main.retired)
        errors.push(
          commandError(
            'invalid-input',
            id,
            ['options', index],
            'A live component main is required.',
          ),
        );
    });
    const swapOptions = input.options ?? undefined;
    checkObject(context.board, { ...object, swapOptions }, errors);
    return errors.length > 0 ? reject(errors) : accept({ id: object.id, swapOptions });
  },
  apply(transaction, input, plan) {
    transaction.patchObject(plan.id, {
      swapOptions: plan.swapOptions === undefined ? undefined : [...plan.swapOptions],
    });
    return { id: plan.id };
  },
};
