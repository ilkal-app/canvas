import { z } from 'zod';

import {
  isBuiltinToken,
  isSameValue,
  rgbaSchema,
  tokenIdSchema,
  tokenNameSchema,
  type TokenId,
} from '@canvas/schema';

import type { TokenWrite } from '../../tokens/token-writes.js';
import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type Command, type CommandContext } from '../command.js';

import {
  agentTokenError,
  customToken,
  duplicateNameError,
  tokenLimitError,
  tokensOf,
} from './token-support.js';

/** Validates the input of {@link setColorTokenCommand}. */
export const setColorTokenInputSchema = z
  .strictObject({
    /** The token to update; absent to create a custom token with a fresh id. */
    id: tokenIdSchema
      .optional()
      .describe('The token to update (a built-in name or a custom id); omit to create one.'),
    /** The token's name, unique on the board; a built-in keeps its own. */
    name: tokenNameSchema,
    /** The light mode's value. */
    light: rgbaSchema.describe("The token's colour in the light mode, [r, g, b, a] in 0..1."),
    /** The dark mode's value. */
    dark: rgbaSchema.describe("The token's colour in the dark mode, [r, g, b, a] in 0..1."),
  })
  .describe("Creates a board colour token, or sets a token's name and light and dark values.");

/** What {@link setColorTokenCommand} returns. */
export interface SetColorTokenResult {
  /** The token's id: the new one for a created token. */
  readonly id: TokenId;
  /** Whether a token was created. */
  readonly isCreated: boolean;
  /** Whether anything changed. */
  readonly isChanged: boolean;
}

/** What {@link setColorTokenCommand} will write. */
export interface SetColorTokenPlan {
  /** The token as it will read, or `null` when nothing changes. */
  readonly token: TokenWrite | null;
  /** The token's id. */
  readonly id: TokenId;
  /** Whether it is created. */
  readonly isCreated: boolean;
  /** The command's time, recorded for a new entry. */
  readonly createdAt: number;
}

/** The most fresh ids tried for a new token past one per token the board has. */
const MAX_ID_ATTEMPTS = 8;

/**
 * A fresh id for a new token: one no token of the board has, nor a built-in. It draws up to one
 * id per existing token more than {@link MAX_ID_ATTEMPTS}, so a generator that repeats the ids it
 * gave before (a seeded one started afresh per command) still reaches a free one.
 *
 * @param context - The command's context.
 * @param errors - Where to add a refusal when none is found.
 * @returns The id, or `undefined`.
 */
function freshTokenId(context: CommandContext, errors: CommandError[]): TokenId | undefined {
  const taken = tokensOf(context.board);
  for (let attempt = 0; attempt < taken.size + MAX_ID_ATTEMPTS; attempt += 1) {
    const id: TokenId = context.createId();
    if (!taken.has(id) && !isBuiltinToken(id)) return id;
  }
  errors.push(commandError('duplicate-id', null, ['id'], 'no fresh colour token id was found'));
  return undefined;
}

/**
 * Plans a creation: the limit, a free name and a fresh id.
 *
 * @param context - The command's context.
 * @param input - The input.
 * @returns The plan's parts, or the errors.
 */
function planCreate(
  context: CommandContext,
  input: z.output<typeof setColorTokenInputSchema>,
): SetColorTokenPlan | CommandError[] {
  const errors: CommandError[] = [];
  const limit = tokenLimitError(context.board);
  if (limit !== undefined) errors.push(limit);
  const duplicate = duplicateNameError(context.board, input.name, undefined);
  if (duplicate !== undefined) errors.push(duplicate);
  const id = errors.length > 0 ? undefined : freshTokenId(context, errors);
  if (id === undefined) return errors;
  const { name, light, dark } = input;
  return { token: { id, name, light, dark }, id, isCreated: true, createdAt: context.now };
}

/**
 * Plans an update of an existing custom token or of a built-in.
 *
 * @param context - The command's context.
 * @param input - The input, with its id.
 * @param id - The token.
 * @returns The plan, or the errors.
 */
function planUpdate(
  context: CommandContext,
  input: z.output<typeof setColorTokenInputSchema>,
  id: TokenId,
): SetColorTokenPlan | CommandError[] {
  const errors: CommandError[] = [];
  const isBuiltin = isBuiltinToken(id);
  const entry = isBuiltin
    ? tokensOf(context.board).get(id)
    : customToken(context.board, id, errors);
  if (errors.length > 0) return errors;
  const denied = agentTokenError(context, id, entry);
  if (denied !== undefined) return [denied];
  const duplicate = isBuiltin ? undefined : duplicateNameError(context.board, input.name, id);
  if (duplicate !== undefined) return [duplicate];
  const token: TokenWrite = {
    id,
    name: isBuiltin ? id : input.name,
    light: input.light,
    dark: input.dark,
  };
  const isSame =
    entry?.name === token.name &&
    isSameValue(entry.light, token.light) &&
    isSameValue(entry.dark, token.dark);
  return { token: isSame ? null : token, id, isCreated: false, createdAt: context.now };
}

/**
 * `setColorToken`: creates a custom colour token with a fresh id when
 * `id` is absent, else sets a token's name and light and dark values, writing only the keys that
 * change, so it merges with a concurrent edit of the token's other fields. A built-in's values
 * may be edited (its entry is then stored; `resetColorToken` erases it), its name is its id
 * whatever is given. Refused: a custom id the board lacks (`missing-token`), a name another
 * token has (`duplicate-token-name`, case-blind), a creation on a board of 64 custom tokens
 * (`too-many-tokens`), and an agent editing a token it did not create or a built-in
 * (`not-own-token`; agents may create). One undo step.
 */
export const setColorTokenCommand: Command<
  typeof setColorTokenInputSchema,
  SetColorTokenPlan,
  SetColorTokenResult
> = {
  name: 'setColorToken',
  description:
    "Creates a board colour token, or sets a token's name and light and dark values; built-ins keep their names.",
  input: setColorTokenInputSchema,
  validate(context, input) {
    const planned =
      input.id === undefined ? planCreate(context, input) : planUpdate(context, input, input.id);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    if (plan.token !== null) {
      transaction.setToken(plan.token, {
        createdBy: transaction.origin.principalId,
        createdAt: plan.createdAt,
      });
    }
    return { id: plan.id, isCreated: plan.isCreated, isChanged: plan.token !== null };
  },
};
