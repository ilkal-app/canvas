import { z } from 'zod';

import { BUILTIN_TOKENS, isBuiltinToken } from '@canvas/schema';

import { commandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import { agentTokenError, tokensOf } from './token-support.js';

/** Validates the input of {@link resetColorTokenCommand}. */
export const resetColorTokenInputSchema = z
  .strictObject({
    /** The built-in token. */
    id: z.enum(BUILTIN_TOKENS).describe('The built-in colour token to reset to its defaults.'),
  })
  .describe("Restores a built-in colour token's default light and dark values.");

/** What {@link resetColorTokenCommand} returns. */
export interface ResetColorTokenResult {
  /** Whether an edited entry was erased; false when the token had its defaults. */
  readonly isChanged: boolean;
}

/** What {@link resetColorTokenCommand} will do. */
export interface ResetColorTokenPlan {
  /** Whether the built-in has a stored entry to erase. */
  readonly isStored: boolean;
}

/**
 * `resetColorToken`: restores a built-in token to its defaults by
 * erasing its stored entry. A custom id is refused by the input schema (`invalid-input`), and an
 * agent may not reset a built-in (`not-own-token`). One undo step.
 */
export const resetColorTokenCommand: Command<
  typeof resetColorTokenInputSchema,
  ResetColorTokenPlan,
  ResetColorTokenResult
> = {
  name: 'resetColorToken',
  description: "Restores a built-in colour token's default light and dark values.",
  input: resetColorTokenInputSchema,
  validate(context, input) {
    if (!isBuiltinToken(input.id)) {
      return reject([commandError('invalid-input', null, ['id'], 'not a built-in colour token')]);
    }
    const entry = tokensOf(context.board).get(input.id);
    const denied = agentTokenError(context, input.id, entry);
    return denied === undefined ? accept({ isStored: entry !== undefined }) : reject([denied]);
  },
  apply(transaction, input, plan) {
    return { isChanged: plan.isStored && transaction.deleteToken(input.id) };
  },
};
