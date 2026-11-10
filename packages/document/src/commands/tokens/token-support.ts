import {
  BUILTIN_TOKENS,
  isBuiltinToken,
  MAX_CUSTOM_TOKENS,
  type TokenEntry,
  type TokenId,
  type TokenTable,
} from '@canvas/schema';

import { commandError, type CommandError } from '../command-error.js';
import type { BoardReader, CommandContext } from '../command.js';

// What the colour token commands share: the board's token table as the
// client has it, the agent rule (an agent may create tokens, and edit, rename, delete or reset
// only entries it created, never a built-in), the creation limit and unique names.

/**
 * The board's colour token table, as a command reads it.
 *
 * @param board - The board.
 * @returns The entries by id; empty for a reader without tokens.
 */
export function tokensOf(board: BoardReader): TokenTable {
  return board.readTokens?.() ?? new Map();
}

/**
 * Looks up a custom token, refusing an id that names no stored custom token and a built-in.
 *
 * @param board - The board before the command.
 * @param tokenId - The token.
 * @param errors - Where to add the refusal.
 * @returns The entry, or `undefined` (an error added).
 */
export function customToken(
  board: BoardReader,
  tokenId: TokenId,
  errors: CommandError[],
): TokenEntry | undefined {
  if (isBuiltinToken(tokenId)) {
    const message = `"${tokenId}" is a built-in colour token: its name is fixed and it cannot be deleted`;
    errors.push(commandError('builtin-token', null, ['id'], message));
    return undefined;
  }
  const entry = tokensOf(board).get(tokenId);
  if (entry === undefined) {
    errors.push(
      commandError('missing-token', null, ['id'], `there is no colour token "${tokenId}"`),
    );
  }
  return entry;
}

/**
 * The agent rule: an agent may change only a custom token it created. People may change any.
 *
 * @param context - The command's context.
 * @param tokenId - The token.
 * @param entry - Its stored entry, if any.
 * @returns The refusal, or `undefined` when the change is allowed.
 */
export function agentTokenError(
  context: CommandContext,
  tokenId: TokenId,
  entry: TokenEntry | undefined,
): CommandError | undefined {
  if (context.origin.kind !== 'agent') return undefined;
  const isOwn = !isBuiltinToken(tokenId) && entry?.createdBy === context.origin.principalId;
  if (isOwn) return undefined;
  const message = isBuiltinToken(tokenId)
    ? `an agent may not change the built-in colour token "${tokenId}"`
    : `an agent may change only the colour tokens it created, not "${tokenId}"`;
  return commandError('not-own-token', null, ['id'], message);
}

/**
 * The refusal of a token creation on a board of `MAX_CUSTOM_TOKENS` or more custom tokens (a
 * creation limit: concurrent creations may take a board past it).
 *
 * @param board - The board before the command.
 * @returns The refusal, or `undefined` when a token may be created.
 */
export function tokenLimitError(board: BoardReader): CommandError | undefined {
  const count = [...tokensOf(board).values()].filter((entry) => !entry.builtin).length;
  if (count < MAX_CUSTOM_TOKENS) return undefined;
  const message = `This board has ${String(count)} colour tokens; the limit is ${String(MAX_CUSTOM_TOKENS)}`;
  return commandError('too-many-tokens', null, [], message);
}

/**
 * Compares names as people read them: trimmed, case-blind.
 *
 * @param name - A name.
 * @returns Its comparison key.
 */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The refusal of a name another token of the board has (a custom token's, or a built-in's).
 *
 * @param board - The board before the command.
 * @param name - The name.
 * @param ownId - The token being named, which may keep its own name; `undefined` for a new one.
 * @returns The refusal, or `undefined` when the name is free.
 */
export function duplicateNameError(
  board: BoardReader,
  name: string,
  ownId: TokenId | undefined,
): CommandError | undefined {
  const key = nameKey(name);
  const isTaken =
    BUILTIN_TOKENS.some((id) => id !== ownId && nameKey(id) === key) ||
    [...tokensOf(board).values()].some(
      (entry) => entry.id !== ownId && !entry.builtin && nameKey(entry.name) === key,
    );
  if (!isTaken) return undefined;
  const message = `another colour token of this board is named "${name}"`;
  return commandError('duplicate-token-name', null, ['name'], message);
}
