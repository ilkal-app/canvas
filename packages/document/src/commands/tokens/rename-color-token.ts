import { z } from 'zod';

import { tokenIdSchema, tokenNameSchema, type TokenId } from '@canvas/schema';

import type { TokenWrite } from '../../tokens/token-writes.js';
import type { CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import { agentTokenError, customToken, duplicateNameError } from './token-support.js';

/** Validates the input of {@link renameColorTokenCommand}. */
export const renameColorTokenInputSchema = z
  .strictObject({
    /** The custom token. */
    id: tokenIdSchema.describe('The custom colour token to rename.'),
    /** Its new name, unique on the board. */
    name: tokenNameSchema,
  })
  .describe("Sets a custom colour token's name.");

/** What {@link renameColorTokenCommand} returns. */
export interface RenameColorTokenResult {
  /** Whether the name changed; false when the token already had it. */
  readonly isChanged: boolean;
}

/** What {@link renameColorTokenCommand} will write: the token as renamed, or nothing. */
export interface RenameColorTokenPlan {
  /** The token with its new name, or `null` when the name does not change. */
  readonly token: TokenWrite | null;
}

/**
 * `renameColorToken`: sets a custom token's name, its `.name` key alone,
 * so it merges with a concurrent recolour. Refused for a built-in (`builtin-token`), an id the
 * board lacks (`missing-token`), a name another token has (`duplicate-token-name`) and an agent
 * renaming a token it did not create (`not-own-token`). One undo step.
 */
export const renameColorTokenCommand: Command<
  typeof renameColorTokenInputSchema,
  RenameColorTokenPlan,
  RenameColorTokenResult
> = {
  name: 'renameColorToken',
  description: "Sets a custom colour token's name; built-in names are fixed.",
  input: renameColorTokenInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const id: TokenId = input.id;
    const entry = customToken(context.board, id, errors);
    if (entry === undefined) return reject(errors);
    const refusal =
      agentTokenError(context, id, entry) ?? duplicateNameError(context.board, input.name, id);
    if (refusal !== undefined) return reject([refusal]);
    const { light, dark } = entry;
    return accept({
      token: entry.name === input.name ? null : { id, name: input.name, light, dark },
    });
  },
  apply(transaction, input, plan) {
    if (plan.token !== null) {
      transaction.setToken(plan.token, { createdBy: transaction.origin.principalId, createdAt: 0 });
    }
    return { isChanged: plan.token !== null };
  },
};
