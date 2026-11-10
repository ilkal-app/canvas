import { z } from 'zod';

import { objectIdSchema, type ObjectId } from '@canvas/schema';

import { checkObject, lookUpNamed } from './command-checks.js';
import type { CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';

/** Validates the input of {@link setLockedCommand}. */
export const setLockedInputSchema = z
  .strictObject({
    /** The objects to lock or unlock; at least one, each listed once. */
    ids: z
      .array(objectIdSchema)
      .min(1)
      .describe('The objects to lock or unlock, each listed once.'),
    /** Whether they end locked. */
    locked: z.boolean().describe('True locks the objects, false unlocks them.'),
  })
  .describe('Locks or unlocks objects.');

/** What {@link setLockedCommand} returns. */
export interface SetLockedResult {
  /** The objects whose lock flag changed, sorted; empty when all already held the value. */
  readonly changedIds: readonly ObjectId[];
}

/** The `setLocked` command's type. */
export type SetLockedCommand = Command<
  typeof setLockedInputSchema,
  readonly ObjectId[],
  SetLockedResult
>;

/**
 * `setLocked`: sets `locked` on each object named. A locked
 * object is left out of marquees and refused by `moveObjects`, `resizeObjects` and
 * `rotateObjects`; it can still be clicked, restyled, reordered and unlocked. `validate` looks
 * the objects up (each must exist and be listed once) and plans only those whose flag differs,
 * so an object that already holds the value is not written, and refuses an object a peer left
 * invalid (`invalid-object`), which the store would refuse to write. `apply` patches `locked` alone, its
 * own key in the grouped layout, so a lock merges with a concurrent move, restyle or reorder of
 * the same object; concurrent locks and unlocks of one object keep one (last writer wins).
 */
export const setLockedCommand: SetLockedCommand = {
  name: 'setLocked',
  description:
    'Locks or unlocks objects. Locked objects cannot be moved, resized, rotated or marquee-selected.',
  input: setLockedInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      input.ids,
      (id) => id,
      (index) => ['ids', index],
    );
    if (errors.length > 0) return reject(errors);
    const changing = named.filter(({ object }) => object.locked !== input.locked);
    // The store validates the whole object it writes, and a peer can leave one the schema rejects.
    const invalid: CommandError[] = [];
    for (const { object } of changing) {
      checkObject(context.board, { ...object, locked: input.locked }, invalid);
    }
    if (invalid.length > 0) return reject(invalid);
    return accept(changing.map(({ object }) => object.id).sort());
  },
  apply(transaction, input, plan) {
    for (const id of plan) transaction.patchObject(id, { locked: input.locked });
    return { changedIds: plan };
  },
};
