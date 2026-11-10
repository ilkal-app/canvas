import { createContext, useContext } from 'react';

import type { ColorMode, TokenTable } from '@canvas/schema';

/**
 * What the colour controls know of the board's colour tokens: the board's token table, to
 * list the tokens and resolve a token value, and the colour mode their swatches are shown in: the
 * selection's effective mode in the style panel (`StylePanel`), the viewer's theme elsewhere.
 */
export interface ColourTokens {
  /** The board's token table: custom tokens and edited built-ins; empty for the defaults. */
  readonly table: TokenTable;
  /** The mode a token's swatch and value are shown in. */
  readonly mode: ColorMode;
}

/** No board: the built-ins at their defaults, in the light mode. */
const DEFAULT_COLOUR_TOKENS: ColourTokens = { table: new Map(), mode: 'light' };

const ColourTokensContext = createContext<ColourTokens>(DEFAULT_COLOUR_TOKENS);

/**
 * Provides the board's colour tokens and the mode to show them in to the colour controls below
 * it; the shell's workspace gives the viewer's theme, and the style panel the selection's mode.
 */
export const ColourTokensProvider = ColourTokensContext.Provider;

/**
 * The colour tokens the nearest {@link ColourTokensProvider} gives: the built-ins at their
 * defaults in the light mode without one.
 *
 * @returns The table and the mode.
 */
export function useColourTokens(): ColourTokens {
  return useContext(ColourTokensContext);
}
