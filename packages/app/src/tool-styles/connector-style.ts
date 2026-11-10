import type { StylePatch } from '@canvas/document';
import type { ConnectorStyle } from '@canvas/tools';

import { toolStrokeStyleOf } from '../state/tool-stroke-style.js';
import type { ToolStyleDefaults } from '../state/tool-style.js';

/**
 * The connector tool's own default style: a straight connector 2 world px wide with an
 * arrow at its end, in `ink`: the connector tool resolves it where the connector starts.
 * The style panel's line section shows and edits it while the connector tool is active with nothing
 * selected, curved route included.
 */
export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
  stroke: { color: 'ink', width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  route: 'straight',
};

/** The connector tool's registered defaults. */
export const toolStyleDefaults: ToolStyleDefaults = {
  tool: 'connector',
  style: { ...DEFAULT_CONNECTOR_STYLE },
};

/**
 * The style a new connector takes from the connector tool's style: each field the style sets, the
 * default's for the rest (a stroke of `null`, which a connector cannot take, keeps the default's).
 * Pure.
 *
 * @param style - The connector tool's style (`ToolStyles.connector`), if any.
 * @returns A whole connector style.
 */
export function connectorToolStyleOf(style: StylePatch | undefined): ConnectorStyle {
  return {
    stroke: style?.stroke ?? DEFAULT_CONNECTOR_STYLE.stroke,
    startCap: style?.startCap ?? DEFAULT_CONNECTOR_STYLE.startCap,
    endCap: style?.endCap ?? DEFAULT_CONNECTOR_STYLE.endCap,
    route: style?.route ?? DEFAULT_CONNECTOR_STYLE.route,
    ...toolStrokeStyleOf(style),
  };
}
