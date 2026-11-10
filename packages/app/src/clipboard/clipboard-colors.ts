import type { TokenTable } from '@canvas/schema';

import type { ClipboardColors } from './clipboard-flavours.js';

/**
 * How a copy's text colours resolve in its HTML: the board's colour tokens, and every
 * object's text in the light mode. Unlike the board and a vector export, the clipboard
 * does not read a frame's `colorMode` or a container's fill: the HTML lands in another app's
 * document, usually on white, and the fill behind the text does not travel with it (documents,
 * notes and mail apps drop or restyle paragraph backgrounds). So theme-default ink is the light
 * theme's dark ink and a token its light value; a colour tuple is written as set (coordinator,
 * 2026-10-28). Pure.
 *
 * @param tokens - The board's colour token table.
 * @returns The tokens and the mode of an object's text: light.
 */
export function clipboardColorsOf(tokens: TokenTable): ClipboardColors {
  return { tokens, modeOf: () => 'light' };
}
