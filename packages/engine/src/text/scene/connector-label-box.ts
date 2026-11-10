import type { BoardObject, ConnectorObject, TextContent } from '@canvas/schema';
import {
  CONNECTOR_LABEL_WRAP_WIDTH,
  connectorLabelPlacementAt,
  type TextBoxGeometry,
} from '@canvas/text';

import { connectorShapeOf } from '../../connectors/connector-shape.js';

// The label's wrapping width lives in @canvas/text, which agents measure labels with.
export { CONNECTOR_LABEL_WRAP_WIDTH };

/**
 * The text box of a connector's label (`connectorLabelPlacementAt` of `@canvas/text`): centred on
 * the point halfway along the route of the placed connector (`connectorShapeOf`). Pure.
 *
 * @param connector - A placed connector.
 * @param content - Its label.
 * @returns The box, in the connector's frame.
 */
export function connectorLabelPlacement(
  connector: ConnectorObject,
  content: TextContent,
): TextBoxGeometry {
  return connectorLabelPlacementAt(connectorShapeOf(connector).label, content);
}

/**
 * Whether an object's text can draw outside the box the spatial index holds for it, so the text
 * pass publishes its drawn bounds for culling: a shape's centred label, which may overflow the
 * shape, and a connector's label, which sits across its route.
 *
 * @param object - The object.
 * @returns True for a shape or a connector.
 */
export function hasOverflowingText(object: BoardObject): boolean {
  return object.type === 'shape' || object.type === 'connector';
}
