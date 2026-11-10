import type { StylePatch } from '@canvas/document';
import type { TextAlign } from '@canvas/engine';
import type { TextStyle } from '@canvas/schema';

import type { ToolStyleDefaults } from '../state/tool-style.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

/**
 * The text tool's own default style: new text in Liberation Sans 24, regular, upright,
 * left-aligned, in `ink`: the text tool resolves it where the text starts. Labels and
 * notes keep `DEFAULT_TEXT_STYLE`'s near-black. The style panel's text section shows and edits it
 * while the text tool is active with nothing selected or edited, and the text tool sets new text in
 * it with the person's choices over it (`ToolStyles`).
 */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'text',
  style: { textStyle: { ...DEFAULT_TEXT_STYLE, color: 'ink' }, align: 'left' },
};

/**
 * The style and alignment new text takes from the text tool's style: each field the style sets,
 * the default's for the rest. Pure.
 *
 * @param style - The text tool's style (`ToolStyles.text`), if any.
 * @returns A whole text style and an alignment.
 */
export function textToolStyleOf(style: StylePatch | undefined): {
  /** The text style. */
  readonly textStyle: TextStyle;
  /** The lines' alignment. */
  readonly align: TextAlign;
} {
  const patch = style?.textStyle ?? {};
  return {
    textStyle: {
      fontFamily: patch.fontFamily ?? DEFAULT_TEXT_STYLE.fontFamily,
      fontSize: patch.fontSize ?? DEFAULT_TEXT_STYLE.fontSize,
      color: patch.color ?? DEFAULT_TEXT_STYLE.color,
      weight: patch.weight ?? DEFAULT_TEXT_STYLE.weight,
      italic: patch.italic ?? DEFAULT_TEXT_STYLE.italic,
      // None and auto unless the tool's style sets them.
      ...(patch.letterSpacing === undefined ? {} : { letterSpacing: patch.letterSpacing }),
      ...(patch.lineHeight === undefined ? {} : { lineHeight: patch.lineHeight }),
      // The tool's variable-font coordinates, when it sets any.
      // (null, which removes them from text, is none here).
      ...(patch.fontVariations === undefined || patch.fontVariations === null
        ? {}
        : { fontVariations: patch.fontVariations }),
    },
    align: style?.align ?? 'left',
  };
}
