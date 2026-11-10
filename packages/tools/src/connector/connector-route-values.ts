import {
  MAX_CURVE_POINT_REACH,
  type ConnectorCurvePoint,
  type ConnectorObject,
} from '@canvas/schema';

/** The longest gap between a click on a handle and the next press that resets it, ms. */
export const ROUTE_HANDLE_RESET_MS = 500;

/** Which route handle: an elbow's middle piece, or a curve's bend. */
export type RouteHandleKind = 'elbow' | 'curve';

/**
 * Whether a press comes soon enough after a click to reset a handle: both carry a time stamp, and
 * the press is no more than {@link ROUTE_HANDLE_RESET_MS} after the click, not before it.
 *
 * @param clicked - When the click was released, ms.
 * @param pressed - When the press came, ms.
 * @returns True for a quick second press.
 */
export function isQuickAfter(clicked: number | undefined, pressed: number | undefined): boolean {
  if (clicked === undefined || pressed === undefined) return false;
  const elapsed = pressed - clicked;
  return elapsed >= 0 && elapsed <= ROUTE_HANDLE_RESET_MS;
}

/**
 * A connector with one route handle's field set, or removed when the value is `undefined`.
 *
 * @param connector - The connector.
 * @param kind - The handle.
 * @param value - Its value.
 * @returns The connector.
 */
export function withHandle(
  connector: ConnectorObject,
  kind: RouteHandleKind,
  value: number | ConnectorCurvePoint | undefined,
): ConnectorObject {
  const field = kind === 'elbow' ? 'elbowMiddle' : 'curvePoint';
  const moved = { ...connector, [field]: value };
  if (value === undefined) Reflect.deleteProperty(moved, field);
  return moved;
}

/**
 * A curve point kept within the schema's reach, so a drag far off the board still writes.
 *
 * @param point - The point.
 * @returns The point, each coordinate clamped.
 */
export function clampedCurvePoint(point: ConnectorCurvePoint): ConnectorCurvePoint {
  const clamp = (value: number) =>
    Math.min(MAX_CURVE_POINT_REACH, Math.max(-MAX_CURVE_POINT_REACH, value));
  return { x: clamp(point.x), y: clamp(point.y) };
}
