import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import { connectorPlacementKey, isSamePlacementKey } from './connector-placement-key.js';
import { resolveConnectorShape, type ConnectorTargetSource } from './connector-placement.js';
import { connectorShapeOf, isSameConnectorShape, placedConnector } from './connector-shape.js';

/** A connector as the document holds it, and the placed value last handed out for it. */
interface PlacedEntry {
  readonly source: ConnectorObject;
  readonly value: ConnectorObject;
  /** What its shape was placed from (`connectorPlacementKey`). */
  readonly key: readonly BoardObject[] | undefined;
}

/**
 * The placed values of connectors: each connector read as a copy carrying the
 * shape it draws on the document as it is now (`placedConnector`, `resolveConnectorShape`), so
 * `connectorShapeOf`, and through it the spatial index's bounds and hit testing's geometry, find
 * its route. A connector whose value, targets and their ancestors are the same values as last
 * time (`connectorPlacementKey`) is not placed again, and one placed again into the same shape
 * keeps its last value, so readers that compare values find nothing to do. The renderer's routing
 * keeps one, and so does the page's hit-test index. One thread.
 */
export class ConnectorPlacements {
  private readonly placed = new Map<ObjectId, PlacedEntry>();

  /**
   * How many connectors have a placed value.
   *
   * @returns The count.
   */
  get size(): number {
    return this.placed.size;
  }

  /**
   * The value last handed out for a connector.
   *
   * @param id - The connector.
   * @returns The value, or `undefined` when none was placed or it was forgotten.
   */
  lastPlaced(id: ObjectId): ConnectorObject | undefined {
    return this.placed.get(id)?.value;
  }

  /**
   * Forgets a connector (it was deleted).
   *
   * @param id - The connector.
   */
  forget(id: ObjectId): void {
    this.placed.delete(id);
  }

  /**
   * The placed value of a connector: the last one handed out when nothing it is placed from
   * changed or its shape came out the same, else a new copy carrying its new shape.
   *
   * @param connector - The connector as the document holds it.
   * @param source - The document, for its targets.
   * @returns The placed value.
   */
  place(connector: ConnectorObject, source: ConnectorTargetSource): ConnectorObject {
    const key = connectorPlacementKey(connector, source);
    const previous = this.placed.get(connector.id);
    const isSameSource = previous?.source === connector;
    // Nothing it is placed from changed (a frame holding it and its targets moved): no placing.
    if (isSameSource && isSamePlacementKey(previous.key, key)) return previous.value;
    const shape = resolveConnectorShape(connector, source);
    if (isSameSource && isSameConnectorShape(connectorShapeOf(previous.value), shape)) {
      this.placed.set(connector.id, { ...previous, key });
      return previous.value;
    }
    const value = placedConnector(connector, shape);
    this.placed.set(connector.id, { source: connector, value, key });
    return value;
  }
}
