import type { Rgba } from '@canvas/schema';

import type { ColorTokenValues } from '../paint/color-palette.js';

/** One colour token as it crosses to the engine worker: plain, structured-cloneable data. */
export interface SerializableColorToken {
  /** The token id. */
  readonly id: string;
  /** Its light value. */
  readonly light: Rgba;
  /** Its dark value. */
  readonly dark: Rgba;
}

/**
 * A board's colour token values as the `tokens` command carries them: every entry,
 * in the table's order, with only its id and values (a name or creator never reaches the engine).
 *
 * @param tokens - The values.
 * @returns The entries.
 */
export function serializeColorTokens(tokens: ColorTokenValues): SerializableColorToken[] {
  return [...tokens].map(([id, { light, dark }]) => ({ id, light, dark }));
}

/**
 * The table a `tokens` command carries, as the worker's scene reads it.
 *
 * @param tokens - The checked entries (`isHostToWorkerMessage`).
 * @returns The values by id.
 */
export function deserializeColorTokens(
  tokens: readonly SerializableColorToken[],
): ColorTokenValues {
  return new Map(tokens.map(({ id, light, dark }) => [id, { light, dark }]));
}
