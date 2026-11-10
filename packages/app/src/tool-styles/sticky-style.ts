import type { StylePatch } from '@canvas/document';
import type { TextAlign } from '@canvas/engine';
import { isTokenRef, type Color, type StickyAspect, type TextStyle } from '@canvas/schema';
import { DEFAULT_NOTE_COLOR } from '@canvas/tools';

import type { ToolStyleDefaults } from '../state/tool-style.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { textToolStyleOf } from './text-style.js';

/**
 * The sticky tool's own default style: yellow notes, their text centred in the text
 * tool's default style. The style panel's note section (the palette) and text section show and edit
 * it while the sticky tool is active with nothing selected, and a swatch picked for a selected note
 * sets it too, so the last colour picked is the next note's.
 */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'sticky',
  style: { color: [...DEFAULT_NOTE_COLOR], textStyle: DEFAULT_TEXT_STYLE, align: 'center' },
};

/**
 * A new note's colour from the sticky tool's: a copy of it, a token as a reference (a note's
 * colour may name a board colour token), the default yellow when unset or `'ink'` (which
 * a note colour never takes).
 *
 * @param color - The tool's colour, if set.
 * @returns The colour.
 */
function noteColorOf(color: StylePatch['color']): Color {
  if (isTokenRef(color)) return { token: color.token };
  return Array.isArray(color) ? [...color] : [...DEFAULT_NOTE_COLOR];
}

/**
 * The colour, text style, alignment and size a new note takes from the sticky tool's style: each
 * field the style sets, the default's for the rest (yellow, the catalogue's text style, centred,
 * square). Pure.
 *
 * @param style - The sticky tool's style (`ToolStyles.sticky`), if any.
 * @returns A whole colour, text style, alignment and size.
 */
export function stickyToolStyleOf(style: StylePatch | undefined): {
  /** The note's colour: a tuple, or a board colour token kept as a reference. */
  readonly color: Color;
  /** Its text's style. */
  readonly textStyle: TextStyle;
  /** Its lines' alignment. */
  readonly align: TextAlign;
  /** Its size: square, or wide when the style says so. */
  readonly aspect: StickyAspect;
} {
  return {
    color: noteColorOf(style?.color),
    textStyle: textToolStyleOf(style).textStyle,
    align: style?.align ?? 'center',
    aspect: style?.aspect === 'wide' ? 'wide' : 'square',
  };
}
