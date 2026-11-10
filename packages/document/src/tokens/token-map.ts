import * as Y from 'yjs';

import {
  BUILTIN_TOKEN_DEFAULTS,
  INK_COLORS,
  isBuiltinToken,
  MAX_TOKEN_NAME_LENGTH,
  principalIdSchema,
  tokenIdSchema,
  type Rgba,
  type TokenEntry,
  type TokenId,
  type TokenValues,
} from '@canvas/schema';

// The stored layout of the board's colour tokens (layout 9): a top-level
// `Y.Map` named `tokens`, one plain value per key, four keys per token, so that concurrent edits
// of a token's name and of each of its values merge: `<id>.identity` (`{ builtin, createdBy,
// createdAt }`; the token exists iff this key does), `<id>.name`, `<id>.light` and `<id>.dark`.
// The built-ins are implicit: an entry is written only when one is edited (its id the built-in's
// name, `builtin: true`, no name key). A key without its `.identity` (an edit concurrent with the
// token's delete) is ignored. This name and these keys are part of the persisted format.

/** The name of the document's top-level map of colour tokens. Part of the persisted format. */
export const TOKENS_MAP_NAME = 'tokens';

/** The four keys of a token, by field. */
export const TOKEN_FIELDS = ['identity', 'name', 'light', 'dark'] as const;

/** One of {@link TOKEN_FIELDS}. */
export type TokenField = (typeof TOKEN_FIELDS)[number];

/**
 * What a token's `.identity` key holds: `builtin` (true exactly when the id is a built-in's
 * name), `createdBy` (a principal, or `null` when unknown) and `createdAt` (ms since the epoch).
 */
export type TokenIdentity = Pick<TokenEntry, 'builtin' | 'createdBy' | 'createdAt'>;

/**
 * The key of one field of a token.
 *
 * @param tokenId - The token.
 * @param field - The field.
 * @returns `<tokenId>.<field>`.
 */
export function tokenKey(tokenId: string, field: TokenField): string {
  return `${tokenId}.${field}`;
}

/** A key of the tokens map, split. */
export interface ParsedTokenKey {
  /** The token's id. */
  readonly tokenId: TokenId;
  /** Which of its keys. */
  readonly field: TokenField;
}

/**
 * Splits a key of the tokens map.
 *
 * @param key - A key, as any peer may have written it.
 * @returns The token id and field, or `undefined` for a key of no token field.
 */
export function parseTokenKey(key: string): ParsedTokenKey | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const tokenId = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!tokenIdSchema.safeParse(tokenId).success) return undefined;
  if (!(TOKEN_FIELDS as readonly string[]).includes(field)) return undefined;
  return { tokenId, field: field as TokenField };
}

/**
 * Tells whether a value is a plain record (not a shared type, not an array).
 *
 * @param value - Anything.
 * @returns True for a plain record.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Y.AbstractType)
  );
}

/**
 * Tells whether a value is the identity of a token (the door's rule): exactly
 * `{ builtin, createdBy, createdAt }`, `builtin` true exactly for a built-in's id, `createdBy` a
 * principal or `null`, `createdAt` a finite number.
 *
 * @param value - The stored value.
 * @param tokenId - The token whose key holds it.
 * @returns True for a token identity.
 */
export function isTokenIdentity(value: unknown, tokenId: string): value is TokenIdentity {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 3) return false;
  const { builtin, createdBy, createdAt } = value;
  return (
    builtin === isBuiltinToken(tokenId) &&
    (createdBy === null || principalIdSchema.safeParse(createdBy).success) &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt)
  );
}

/**
 * Tells whether a value is a token name the door and the store accept.
 *
 * @param value - The value.
 * @returns True for a string of 1 to `MAX_TOKEN_NAME_LENGTH` code units, not blank.
 */
export function isTokenName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_TOKEN_NAME_LENGTH && value.trim().length > 0
  );
}

/**
 * Tells whether a value is a token's light or dark value: four numbers in [0, 1].
 *
 * @param value - The value.
 * @returns True for a colour tuple.
 */
export function isTokenValue(value: unknown): value is Rgba {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (channel) =>
        typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1,
    )
  );
}

/**
 * The values a token falls back to for a missing or unreadable key: a built-in's defaults, ink
 * for a custom token.
 *
 * @param tokenId - The token.
 * @returns The fallback values.
 */
function fallbackValues(tokenId: string): TokenValues {
  return isBuiltinToken(tokenId) ? BUILTIN_TOKEN_DEFAULTS[tokenId] : INK_COLORS;
}

/**
 * Reads one token's entry from the map, when its identity is stored.
 *
 * @param map - The tokens map.
 * @param tokenId - The token.
 * @returns The entry, frozen, or `undefined` when the token is not stored.
 */
export function readToken(map: Y.Map<unknown>, tokenId: string): TokenEntry | undefined {
  const identity = map.get(tokenKey(tokenId, 'identity'));
  if (!isTokenIdentity(identity, tokenId)) return undefined;
  const name = map.get(tokenKey(tokenId, 'name'));
  const light = map.get(tokenKey(tokenId, 'light'));
  const dark = map.get(tokenKey(tokenId, 'dark'));
  const fallback = fallbackValues(tokenId);
  return Object.freeze({
    id: tokenId,
    name: identity.builtin || !isTokenName(name) ? tokenId : name,
    light: isTokenValue(light) ? light : fallback.light,
    dark: isTokenValue(dark) ? dark : fallback.dark,
    builtin: identity.builtin,
    createdBy: identity.createdBy,
    createdAt: identity.createdAt,
  });
}

/**
 * Reads the board's token table from the tokens map: every token whose `.identity` key holds its
 * identity, sorted by id; a name, light or dark key that is absent or unreadable reads as the id
 * and the built-in defaults (ink for a custom token). Built-ins with no entry are not listed:
 * they resolve to their defaults (`resolveColor`).
 *
 * @param map - The tokens map.
 * @returns The entries by id.
 */
export function readTokens(map: Y.Map<unknown>): Map<TokenId, TokenEntry> {
  const ids: string[] = [];
  for (const key of map.keys()) {
    const parsed = parseTokenKey(key);
    if (parsed?.field === 'identity') ids.push(parsed.tokenId);
  }
  const entries = new Map<TokenId, TokenEntry>();
  for (const id of ids.sort()) {
    const entry = readToken(map, id);
    if (entry !== undefined) entries.set(id, entry);
  }
  return entries;
}
