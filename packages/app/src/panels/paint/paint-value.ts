import {
  isGradient,
  isImagePaint,
  type Gradient,
  type GradientStop,
  type Paint,
} from '@canvas/schema';

import { isSameColour } from '../controls/mixed-value.js';

/**
 * Whether two gradient stop lists are the same, stop by stop.
 *
 * @param first - Stops.
 * @param second - Other stops.
 * @returns True when every offset and colour is equal.
 */
function isSameStops(first: readonly GradientStop[], second: readonly GradientStop[]): boolean {
  return (
    first.length === second.length &&
    first.every((stop, index) => {
      const other = second[index];
      return stop.offset === other?.offset && isSameColour(stop.color, other.color);
    })
  );
}

/**
 * Whether two gradients are the same: kind, geometry and stops.
 *
 * @param first - A gradient.
 * @param second - Another.
 * @returns True when equal field by field.
 */
function isSameGradient(first: Gradient, second: Gradient): boolean {
  if (!isSameStops(first.stops, second.stops)) return false;
  if (first.type === 'linear') return second.type === 'linear' && first.angle === second.angle;
  return (
    second.type === 'radial' &&
    first.radius === second.radius &&
    first.center.x === second.center.x &&
    first.center.y === second.center.y
  );
}

/**
 * Whether two paints (or two nones) are the same, so a selection showing them is not mixed
 * (objects with different paints show "Mixed").
 *
 * @param first - A paint or null.
 * @param second - Another paint or null.
 * @returns True when both are none, the same colour, equal gradients, or equal image paints.
 */
export function isSamePaint(first: Paint | null, second: Paint | null): boolean {
  if (isGradient(first)) return isGradient(second) && isSameGradient(first, second);
  if (isImagePaint(first) || isImagePaint(second)) {
    return JSON.stringify(first) === JSON.stringify(second);
  }
  return !isGradient(second) && isSameColour(first, second);
}
