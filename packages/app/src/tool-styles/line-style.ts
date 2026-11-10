import type { StylePatch } from '@canvas/document';
import type { LineStyle } from '@canvas/tools';

import { toolStrokeStyleOf } from '../state/tool-stroke-style.js';
import type { ToolStyleDefaults } from '../state/tool-style.js';

/**
 * The line tool's own default style: a straight line 2 world px wide with no caps, in
 * `ink`: the line tool resolves it where the line starts, `ink` on the empty canvas and a
 * contrasting colour over an object. Shift+L's arrow sets an `arrow` end cap over it
 * (`ARROW_VARIANT`); the style panel's line section shows and edits it while the line tool is
 * active with nothing selected.
 */
export const DEFAULT_LINE_STYLE: LineStyle = {
  stroke: { color: 'ink', width: 2 },
  startCap: 'none',
  endCap: 'none',
  route: 'straight',
};

/** The line tool's registered defaults. */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'line',
  style: { ...DEFAULT_LINE_STYLE },
};

/**
 * The style a new line takes from the line tool's style: each field the style sets, the
 * default's for the rest; a connector's `curved` route, which a line cannot take, draws straight.
 * Pure.
 *
 * @param style - The line tool's style (`ToolStyles.line`), if any.
 * @returns A whole line style.
 */
export function lineToolStyleOf(style: StylePatch | undefined): LineStyle {
  return {
    stroke: style?.stroke ?? DEFAULT_LINE_STYLE.stroke,
    startCap: style?.startCap ?? DEFAULT_LINE_STYLE.startCap,
    endCap: style?.endCap ?? DEFAULT_LINE_STYLE.endCap,
    route: style?.route === 'elbow' ? 'elbow' : 'straight',
    ...toolStrokeStyleOf(style),
  };
}
