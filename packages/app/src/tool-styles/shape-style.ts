import type { StylePatch } from '@canvas/document';
import type { TextStyle } from '@canvas/schema';
import { DEFAULT_SHAPE_STYLE, type NewShapeStyle } from '@canvas/tools';

import type { ToolStyleDefaults } from '../state/tool-style.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { textToolStyleOf } from './text-style.js';

/**
 * The shape tool's own default style: a pale blue rectangle with a 2-unit `ink` outline
 * (resolved where the shape starts), sharp corners, five sides or points for a polygon or
 * star, and labels in the text tool's default style (`DEFAULT_SHAPE_STYLE` of the tools package).
 * The style panel's shape, fill and stroke, and text sections show and edit it while the shape tool
 * is active with nothing selected; a kind picked for selected shapes sets it too, so the last kind
 * picked is the next shape's.
 */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'shape',
  style: {
    kind: DEFAULT_SHAPE_STYLE.kind,
    fill: DEFAULT_SHAPE_STYLE.fill === null ? null : structuredClone(DEFAULT_SHAPE_STYLE.fill),
    stroke:
      DEFAULT_SHAPE_STYLE.stroke === null ? null : structuredClone(DEFAULT_SHAPE_STYLE.stroke),
    cornerRadius: DEFAULT_SHAPE_STYLE.cornerRadius,
    sides: DEFAULT_SHAPE_STYLE.sides,
    textStyle: DEFAULT_TEXT_STYLE,
  },
};

/**
 * The shape and label style a new shape takes from the shape tool's style: each field the style
 * sets, the default's for the rest (a fill or stroke set to none stays none). Pure.
 *
 * @param style - The shape tool's style (`ToolStyles.shape`), if any.
 * @returns A whole shape style and its label's text style.
 */
export function shapeToolStyleOf(style: StylePatch | undefined): {
  /** The shape's kind, fill, outline, corner radius and sides. */
  readonly shape: NewShapeStyle;
  /** The style its label is typed in. */
  readonly textStyle: TextStyle;
} {
  return {
    shape: {
      kind: style?.kind ?? DEFAULT_SHAPE_STYLE.kind,
      fill: style?.fill === undefined ? DEFAULT_SHAPE_STYLE.fill : style.fill,
      stroke: style?.stroke === undefined ? DEFAULT_SHAPE_STYLE.stroke : style.stroke,
      // A shape's radius is one number; a frame's four are never a shape's.
      cornerRadius:
        typeof style?.cornerRadius === 'number'
          ? style.cornerRadius
          : DEFAULT_SHAPE_STYLE.cornerRadius,
      sides: style?.sides ?? DEFAULT_SHAPE_STYLE.sides,
    },
    textStyle: textToolStyleOf(style).textStyle,
  };
}
