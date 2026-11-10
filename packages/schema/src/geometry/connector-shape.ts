import type { Point } from '../fields/point.js';
import type { ConnectorObject } from '../objects/connector-object.js';

import type { PlacedConnectorEnd } from './connector-ends.js';
import { connectorLabelPoint } from './connector-label.js';
import { connectorPathOf, type ConnectorPath } from './connector-path.js';

/** What a connector draws, derived from its ends and their targets when drawn. */
export interface ConnectorShape {
  /** Its centre line, in its own frame. */
  readonly path: ConnectorPath;
  /** Where its label is centred, in its own frame (`connectorLabelPoint`). */
  readonly label: Point;
}

/**
 * A connector's shape from its placed ends: its path and its label point.
 *
 * @param connector - The connector; only `route`, `labelPosition` and its route handles
 *   (`elbowMiddle`, `curvePoint`) are read.
 * @param from - The placed start.
 * @param to - The placed end.
 * @returns The shape.
 */
export function connectorShapeFrom(
  connector: Pick<ConnectorObject, 'route'> &
    Partial<Pick<ConnectorObject, 'labelPosition' | 'elbowMiddle' | 'curvePoint'>>,
  from: PlacedConnectorEnd,
  to: PlacedConnectorEnd,
): ConnectorShape {
  const path = connectorPathOf(from, to, connector.route, connector);
  return { path, label: connectorLabelPoint(path, connector.labelPosition) };
}
