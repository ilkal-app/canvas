import {
  BUILTIN_TOKEN_DEFAULTS,
  BUILTIN_TOKENS,
  isBuiltinToken,
  type TokenId,
  type TokenTable,
  type TokenValues,
} from '@canvas/schema';

/** One colour token as the colour controls list it. */
export interface TokenOption {
  /** The token's id: a built-in's name or a custom id. */
  readonly id: TokenId;
  /** Its name: a built-in's is its id. */
  readonly name: string;
  /** Its light and dark values on this board. */
  readonly values: TokenValues;
  /** Whether it is a built-in (never deleted; reset to its defaults instead). */
  readonly isBuiltin: boolean;
  /** Whether it is a built-in whose values the board changed (its entry is stored). */
  readonly isEdited: boolean;
}

/**
 * The board's colour tokens in the order the colour controls list them: the six built-ins in
 * their fixed order (`BUILTIN_TOKENS`), each with the board's values or its defaults, then the
 * custom tokens by name (case-blind, then by id, so two clients list them alike). Pure.
 *
 * @param table - The board's token table.
 * @returns The tokens.
 */
export function tokenOptionsOf(table: TokenTable): TokenOption[] {
  const builtins = BUILTIN_TOKENS.map((id): TokenOption => {
    const entry = table.get(id);
    return {
      id,
      name: id,
      values: entry ?? BUILTIN_TOKEN_DEFAULTS[id],
      isBuiltin: true,
      isEdited: entry !== undefined,
    };
  });
  const customs = [...table.values()]
    .filter((entry) => !entry.builtin && !isBuiltinToken(entry.id))
    .sort(
      (first, second) =>
        first.name.localeCompare(second.name, 'en', { sensitivity: 'base' }) ||
        (first.id < second.id ? -1 : first.id > second.id ? 1 : 0),
    )
    .map((entry): TokenOption => ({
      id: entry.id,
      name: entry.name,
      values: entry,
      isBuiltin: false,
      isEdited: false,
    }));
  return [...builtins, ...customs];
}

/** What a token the board does not have (deleted, or never made) is called. */
export const UNKNOWN_TOKEN_NAME = 'Unknown colour';

/**
 * A token's name on a board: a built-in's id, a custom token's name, or
 * {@link UNKNOWN_TOKEN_NAME} for a token the board does not have (it draws as ink). Pure.
 *
 * @param id - The token's id.
 * @param table - The board's token table.
 * @returns The name.
 */
export function tokenNameOf(id: TokenId, table: TokenTable): string {
  if (isBuiltinToken(id)) return id;
  return table.get(id)?.name ?? UNKNOWN_TOKEN_NAME;
}

/**
 * A name for a new custom token: "Colour 1", "Colour 2", … the first no token has (names are
 * unique per board, case-blind, built-ins included). Pure.
 *
 * @param table - The board's token table.
 * @returns The name.
 */
export function nextTokenName(table: TokenTable): string {
  const taken = new Set([...table.values()].map((entry) => entry.name.toLowerCase()));
  let index = 1;
  while (taken.has(`colour ${String(index)}`)) index += 1;
  return `Colour ${String(index)}`;
}
