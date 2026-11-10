import type { Point } from '@canvas/schema';

/**
 * Where a line leaves a gap (a connector's line breaks around its label): a box, in the
 * line's own frame, centred on a point of the line. The stretch of the line around that point
 * that runs inside the box is not drawn. Plain data, structured-cloneable.
 */
export interface LineGap {
  /** The box's centre: the label's centre, a point of the line. */
  readonly center: Point;
  /** Half the box's width, world units. */
  readonly halfWidth: number;
  /** Half the box's height, world units. */
  readonly halfHeight: number;
}

/** The two drawn stretches of a line with a gap; either may be empty (fewer than two points). */
export interface GappedRoute {
  /** From the line's start to where it enters the gap. */
  readonly before: readonly Point[];
  /** From where it leaves the gap to the line's end. */
  readonly after: readonly Point[];
}

/** A line passing farther than this from the gap's centre has no gap, world units. */
const ON_LINE_TOLERANCE = 0.5;

/**
 * Splits a polyline around a gap: the stretch that runs inside the gap's box, on either side of
 * the polyline's point nearest the box's centre, is left out; any later visit of the box (an
 * elbow folding back) is drawn. A polyline that does not pass through the centre is not split.
 * Pure; the input is not changed.
 *
 * @param route - The polyline, at least two points.
 * @param gap - The gap.
 * @returns The stretches before and after the gap, or the whole route as `before` with no gap.
 */
export function splitAroundGap(route: readonly Point[], gap: LineGap): GappedRoute {
  const nearest = nearestOnRoute(route, gap.center);
  if (nearest === undefined || nearest.distance > ON_LINE_TOLERANCE) {
    return { before: route, after: [] };
  }
  const { index, point } = nearest;
  const forward = exitAlong([point, ...route.slice(index + 1)], gap);
  const backward = exitAlong([point, ...route.slice(0, index + 1).reverse()], gap);
  return {
    // The backward walk's `next` counts back from the nearest point: route[index + 1 - next] is
    // the last point before the exit.
    before:
      backward === undefined ? [] : [...route.slice(0, index + 2 - backward.next), backward.exit],
    after:
      forward === undefined
        ? []
        : [forward.exit, ...route.slice(index + 1).slice(forward.next - 1)],
  };
}

/**
 * The point of a polyline nearest a point: its segment's index and its distance.
 *
 * @param route - The polyline.
 * @param target - The point.
 * @returns The nearest point, or `undefined` for a polyline without segments.
 */
function nearestOnRoute(
  route: readonly Point[],
  target: Point,
): { readonly index: number; readonly point: Point; readonly distance: number } | undefined {
  let best: { index: number; point: Point; distance: number } | undefined;
  for (let index = 0; index + 1 < route.length; index += 1) {
    const from = route[index];
    const to = route[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((target.x - from.x) * dx + (target.y - from.y) * dy) / lengthSquared),
          );
    const point = { x: from.x + dx * t, y: from.y + dy * t };
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (best === undefined || distance < best.distance) best = { index, point, distance };
  }
  return best;
}

/**
 * Where a polyline starting inside the gap's box first leaves it: the exit point and how many
 * of the polyline's points (from its second) come before it.
 *
 * @param path - The polyline, its first point inside the box.
 * @param gap - The gap.
 * @returns The exit, or `undefined` when the polyline ends inside the box.
 */
function exitAlong(
  path: readonly Point[],
  gap: LineGap,
): { readonly exit: Point; readonly next: number } | undefined {
  for (let index = 0; index + 1 < path.length; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (from === undefined || to === undefined) continue;
    const t = exitParameter(from, to, gap);
    if (t !== undefined) {
      return {
        exit: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        next: index + 1,
      };
    }
  }
  return undefined;
}

/**
 * The fraction of a segment, starting inside the gap's box, at which it leaves the box.
 *
 * @param from - The segment's start, inside the box.
 * @param to - Its end.
 * @param gap - The gap.
 * @returns The fraction, 0 to 1, or `undefined` when the segment ends inside the box.
 */
function exitParameter(from: Point, to: Point, gap: LineGap): number | undefined {
  let t = Number.POSITIVE_INFINITY;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0) t = Math.min(t, (gap.center.x + Math.sign(dx) * gap.halfWidth - from.x) / dx);
  if (dy !== 0) t = Math.min(t, (gap.center.y + Math.sign(dy) * gap.halfHeight - from.y) / dy);
  return t >= 0 && t <= 1 ? t : undefined;
}
