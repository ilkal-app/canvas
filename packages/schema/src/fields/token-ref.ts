import { z } from 'zod';

import { ID_PATTERN } from '../ids/object-id.js';

// A colour that names a board colour token instead of holding channels:
// `{ token: id }`, strict, with no `type` key. A paint tells its branches apart by shape alone:
// an array is a colour tuple, an object with `token` a token reference, an object with `type` a
// gradient (and, later, an image fill), so the three never collide.

/**
 * Validates a token id: a built-in token's name (`BUILTIN_TOKENS`) or a custom token's id, both
 * 1 to 64 of `[A-Za-z0-9_-]` (the object id pattern).
 */
export const tokenIdSchema = z
  .string()
  .regex(ID_PATTERN, 'a token id is 1 to 64 letters, digits, "_" or "-"')
  .describe(
    "A colour token's id: a built-in name (ink, text, muted, surface, border, accent) or a custom token's id.",
  );

/** The id of a colour token: a built-in name or a custom id. */
export type TokenId = z.output<typeof tokenIdSchema>;

/**
 * Validates a reference to a board colour token: exactly `{ token: id }`. Resolved per object
 * with `resolveColor` in the object's effective colour mode (`effectiveColorMode`).
 */
export const tokenRefSchema = z
  .strictObject({
    /** The token's id. */
    token: tokenIdSchema,
  })
  .describe("A board colour token, { token: id }: drawn in the token's light or dark value.");

/** A reference to a board colour token. */
export type TokenRef = z.output<typeof tokenRefSchema>;

/**
 * Tells whether a value is a well-formed token reference: a plain record whose only key is
 * `token`, holding a valid token id. Pure; never throws.
 *
 * @param value - Anything, as stored or given.
 * @returns True for exactly `{ token: id }`.
 */
export function isTokenRef(value: unknown): value is TokenRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'token') return false;
  const { token } = value as { readonly token?: unknown };
  return typeof token === 'string' && ID_PATTERN.test(token);
}
