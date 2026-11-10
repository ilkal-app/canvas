import type {
  ConnectorEnd,
  ConnectorObject,
  LineCap,
  ObjectId,
  Point,
  Stroke,
  StrokeStyle,
  UnitPoint,
} from '@canvas/schema';

import { strokeStyleOf } from '../stroke-style-of.js';

import type { ConnectorStyle } from './connector-context.js';
import type { ConnectorToolEnd } from './connector-end.js';

/** One end of a `connect` input: an object with its anchor, or a point on the board. */
type ConnectEndInput =
  | {
      /** The object the end attaches to. */
      readonly objectId: ObjectId;
      /** Where on its bounds, as fractions of its size; null picks a side. */
      readonly anchor: UnitPoint | null;
    }
  | {
      /** A free end, world units in the board's frame. */
      readonly point: Point;
    };

/**
 * What the connector tool hands the `connect` command of `@canvas/document`, with the stroke's
 * dash, join, miter limit and cap as far as the tool's style sets them.
 */
export interface ConnectInput extends StrokeStyle {
  /** The new connector's id. */
  readonly id: ObjectId;
  /** The start. */
  readonly from: ConnectEndInput;
  /** The end. */
  readonly to: ConnectEndInput;
  /** Straight, elbow or curved. */
  readonly route: ConnectorObject['route'];
  /** The line's colour and width. */
  readonly stroke: Stroke;
  /** The decoration at the start. */
  readonly startCap: LineCap;
  /** The decoration at the end. */
  readonly endCap: LineCap;
}

/**
 * A tool end as the `connect` command takes it: an object with its anchor, or a point on the
 * board.
 *
 * @param end - The end.
 * @returns The command's end.
 */
function commandEnd(end: ConnectorToolEnd): ConnectEndInput {
  return end.kind === 'object'
    ? { objectId: end.objectId, anchor: end.anchor }
    : { point: { x: end.point.x, y: end.point.y } };
}

/**
 * A tool end as a connector at the board's root, unturned at the origin, stores it: its frame is
 * the board's, so a free point is stored as it is.
 *
 * @param end - The end.
 * @returns The stored end.
 */
function storedEnd(end: ConnectorToolEnd): ConnectorEnd {
  return end.kind === 'object'
    ? { kind: 'object', objectId: end.objectId, anchor: end.anchor }
    : { kind: 'point', x: end.point.x, y: end.point.y };
}

/**
 * The `connect` input a drag of the connector tool writes: the
 * connector at the board's root with the drag's id, its two ends, and the tool's style, with no
 * label. Pure.
 *
 * @param id - The new connector's id, chosen when the drag started.
 * @param from - The start.
 * @param to - The end.
 * @param style - The connector tool's style.
 * @returns The input.
 */
export function connectInputOf(
  id: ObjectId,
  from: ConnectorToolEnd,
  to: ConnectorToolEnd,
  style: ConnectorStyle,
): ConnectInput {
  return {
    id,
    from: commandEnd(from),
    to: commandEnd(to),
    route: style.route,
    stroke: style.stroke,
    startCap: style.startCap,
    endCap: style.endCap,
    ...strokeStyleOf(style),
  };
}

/**
 * The connector a drag previews, as `connect` would write it, without the fields the command
 * stamps (stacking key, author and times): at the board's root, unturned at the origin, so its
 * free ends are board points. Pure.
 *
 * @param id - The connector's id.
 * @param from - The start.
 * @param to - The end.
 * @param style - The connector tool's style.
 * @returns The connector, unstamped.
 */
export function newConnectorObject(
  id: ObjectId,
  from: ConnectorToolEnd,
  to: ConnectorToolEnd,
  style: ConnectorStyle,
): Omit<ConnectorObject, 'z' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  return {
    id,
    type: 'connector',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    from: storedEnd(from),
    to: storedEnd(to),
    route: style.route,
    stroke: style.stroke,
    startCap: style.startCap,
    endCap: style.endCap,
    ...strokeStyleOf(style),
    label: null,
  };
}
