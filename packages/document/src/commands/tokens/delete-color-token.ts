import { z } from 'zod';

import { tokenIdSchema } from '@canvas/schema';

import type { CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import { agentTokenError, customToken } from './token-support.js';

/** Validates the input of {@link deleteColorTokenCommand}. */
export const deleteColorTokenInputSchema = z
  .strictObject({
    /** The custom token. */
    id: tokenIdSchema.describe('The custom colour token to delete.'),
  })
  .describe('Deletes a custom colour token; objects naming it then draw as ink.');

/** What {@link deleteColorTokenCommand} returns. */
export interface DeleteColorTokenResult {
  /** Whether a stored key was deleted. */
  readonly isDeleted: boolean;
}

/**
 * `deleteColorToken`: deletes a custom token's keys. Objects still
 * naming it are not rewritten: they draw as ink and the board reports `unknown-color-token`.
 * Refused for a built-in (`builtin-token`; `resetColorToken` restores its defaults), an id the
 * board lacks (`missing-token`) and an agent deleting a token it did not create
 * (`not-own-token`). One undo step.
 */
export const deleteColorTokenCommand: Command<
  typeof deleteColorTokenInputSchema,
  null,
  DeleteColorTokenResult
> = {
  name: 'deleteColorToken',
  description: 'Deletes a custom colour token; objects naming it draw as ink.',
  input: deleteColorTokenInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const entry = customToken(context.board, input.id, errors);
    if (entry === undefined) return reject(errors);
    const denied = agentTokenError(context, input.id, entry);
    return denied === undefined ? accept(null) : reject([denied]);
  },
  apply(transaction, input) {
    return { isDeleted: transaction.deleteToken(input.id) };
  },
};
