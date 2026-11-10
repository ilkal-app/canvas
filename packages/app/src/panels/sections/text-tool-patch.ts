import { mergeFontVariations } from '@canvas/schema';
import {
  toggledItalic,
  toggledStrikethrough,
  toggledUnderline,
  toggledWeight,
  type TextStylePatch,
} from '@canvas/tools';

import type { TextStyleChange } from '../../engine/document-text.js';
import { weightPatchOf } from '../../text-input/curated-variable.js';

/**
 * A text style change as fields of the text tool's style (`applyStyle` with nothing selected).
 *
 * @param change - The change.
 * @param style - The tool's text style now, to resolve a toggle against.
 * @returns The fields to set.
 */
export function toolPatchOf(change: TextStyleChange, style: TextStylePatch) {
  switch (change.kind) {
    case 'style':
      return { textStyle: toolTextStyleOf(change.patch, style) };
    case 'toggleBold':
      return {
        textStyle: toolTextStyleOf(weightPatchOf(toggledWeight(style), style.fontFamily), style),
      };
    case 'toggleItalic':
      return { textStyle: { italic: toggledItalic(style) } };
    case 'toggleUnderline':
      return { textStyle: { underline: toggledUnderline(style) } };
    case 'toggleStrikethrough':
      return { textStyle: { strikethrough: toggledStrikethrough(style) } };
    case 'list':
    case 'listLevel':
      // A list is a paragraph's, not the tool's style.
      return {};
    case 'align':
      return { align: change.align };
    case 'direction':
    case 'preview':
    case 'endPreview':
      // A drag's preview shows on text, not on a tool's style.
      return {};
  }
}

/**
 * A style patch as the text tool's style keeps it: some axes merged into its coordinates, as a
 * whole record, the rest as they are; a whole record the patch gives wins, as it does
 * on text.
 *
 * @param patch - The panel's patch.
 * @param style - The tool's shown style.
 * @returns The patch for the tool's style.
 */
function toolTextStyleOf(patch: TextStylePatch, style: TextStylePatch): TextStylePatch {
  const { fontVariationsAxes, ...fields } = patch;
  if (fontVariationsAxes === undefined) return patch;
  if (fields.fontVariations !== undefined) return fields;
  return {
    ...fields,
    fontVariations: mergeFontVariations(style.fontVariations, fontVariationsAxes) ?? {},
  };
}
