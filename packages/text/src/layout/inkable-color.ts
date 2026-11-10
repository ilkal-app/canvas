import { INK, isTokenRef, type Rgba, type TokenRef } from '@canvas/schema';

/**
 * The base colour: what an unreadable stroke or text colour draws as, opaque black (the text
 * attributes' base style).
 */
export const BASE_COLOR: Rgba = Object.freeze([0, 0, 0, 1]) as unknown as Rgba;

/**
 * Reads a stored stroke or text colour: exactly `'ink'`, a valid colour token reference,
 * resolved where records are written as `'ink'` is, a tuple of four numbers, or else
 * the {@link BASE_COLOR}. Pure.
 *
 * @param value - The stored value.
 * @returns The colour, the ink token or the token reference.
 */
export function readInkable(value: unknown): Rgba | typeof INK | TokenRef {
  if (value === INK) return INK;
  if (isTokenRef(value)) return value;
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((channel) => typeof channel === 'number')
  )
    return value as Rgba;
  return BASE_COLOR;
}
