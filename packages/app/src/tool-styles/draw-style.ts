import type { FreehandTool, Rgba } from '@canvas/schema';
import type { DrawStyle } from '@canvas/tools';

import type { ToolStyle, ToolStyleDefaults } from '../state/tool-style.js';

/**
 * The highlighter's default colour: the design's amber swatch, `hand/you`, at its light theme value
 * (#B7801C), which a stroke stores as it stores the other swatches.
 */
export const HIGHLIGHTER_AMBER: Rgba = [183 / 255, 128 / 255, 28 / 255, 1];

/**
 * Each draw sub-tool's own default style: the pencil 2 world px of `ink` (
 * resolved where the stroke starts), the marker 6 px of `ink` with pressure, and the highlighter 16
 * px of amber at 40% opacity.
 */
export const DEFAULT_DRAW_STYLES: Readonly<Record<FreehandTool, DrawStyle>> = {
  pencil: { tool: 'pencil', stroke: { color: 'ink', width: 2 } },
  marker: { tool: 'marker', stroke: { color: 'ink', width: 6 } },
  highlighter: {
    tool: 'highlighter',
    stroke: { color: HIGHLIGHTER_AMBER, width: 16 },
    opacity: 0.4,
  },
};

/**
 * The draw tool's registered defaults: the pencil. Only the sub-tool is stored, so a sub-tool
 * picked later draws in its own defaults (`drawToolStyleOf`) until the person changes them;
 * per-sub-tool memory and the panel come with.
 */
export const toolStyleDefaults: ToolStyleDefaults = { tool: 'draw', style: { tool: 'pencil' } };

/**
 * The style a new stroke takes from the draw tool's style: its sub-tool (the pencil when
 * unset), and the stroke and opacity it sets, else the sub-tool's defaults; with the eraser in
 * use (`isEraser`), the same look, erasing. Pure.
 *
 * @param style - The draw tool's style (`ToolStyles.draw`), if any.
 * @returns A whole draw style.
 */
export function drawToolStyleOf(style: ToolStyle | undefined): DrawStyle {
  const tool = style?.tool ?? 'pencil';
  const defaults = DEFAULT_DRAW_STYLES[tool];
  const opacity = style?.opacity ?? defaults.opacity;
  return {
    tool,
    stroke: style?.stroke ?? defaults.stroke,
    ...(opacity === undefined ? {} : { opacity }),
    ...(style?.isEraser === true ? { isEraser: true } : {}),
  };
}
