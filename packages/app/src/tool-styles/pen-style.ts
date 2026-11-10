import type { StylePatch } from '@canvas/document';
import type { Stroke } from '@canvas/schema';
import type { PenStyle } from '@canvas/tools';

import { toolStrokeStyleOf } from '../state/tool-stroke-style.js';
import type { ToolStyleDefaults } from '../state/tool-style.js';

/**
 * The pen's default outline: 2 world px of `ink`, which the pen resolves where the path
 * starts; the prototype's `DEFAULT_STROKE` was near-black.
 */
export const DEFAULT_PEN_STROKE: Stroke = { color: 'ink', width: 2 };

/**
 * The pen tool's own default style: a 2 px `ink` stroke and no fill. The style panel's
 * fill and stroke section shows and edits it while the pen is active with nothing selected, and new
 * paths start in it with the person's choices over it.
 */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'pen',
  style: { stroke: DEFAULT_PEN_STROKE, fill: null },
};

/**
 * The paint a new path takes from the pen tool's style: each field the style sets, the
 * default's for the rest. Pure.
 *
 * @param style - The pen tool's style (`ToolStyles.pen`), if any.
 * @returns The stroke and fill.
 */
export function penToolStyleOf(style: StylePatch | undefined): PenStyle {
  return {
    stroke: style?.stroke === undefined ? DEFAULT_PEN_STROKE : style.stroke,
    fill: style?.fill ?? null,
    ...toolStrokeStyleOf(style),
  };
}
