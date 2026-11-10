import type { Point } from '../fields/point.js';
import type { LineObject } from '../objects/line-object.js';

/**
 * The route of an elbow line between two points:
 * axis-aligned pieces with one bend in the middle. When the points are further apart across than
 * down (`|dx| ≥ |dy|`), the route leaves horizontally, turns vertically at the middle x and
 * arrives horizontally; otherwise it leaves vertically, turns horizontally at the middle y and
 * arrives vertically, so the long pieces run along the longer axis and the arrowheads at either
 * end point the way the line mostly travels. Points already on one horizontal or vertical line
 * need no bend: the route is the straight piece between them (a lone point when they coincide).
 * Rendering (the path pass's line meshes) and hit testing (`objectGeometry`) both route through
 * this one function, so a line is picked exactly where it is drawn. Pure: never mutates its
 * inputs, and the result stays inside the box of the two points, which is the line's stored
 * bounds (the schema's `localBounds`).
 *
 * @param from - The line's first point.
 * @param to - Its last point.
 * @returns The route's corners, `from` first and `to` last: four points with a bend, two for a
 *   straight piece, one when the points coincide.
 */
export function elbowRoute(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return [{ x: from.x, y: from.y }];
  if (dx === 0 || dy === 0)
    return [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const middleX = from.x + dx / 2;
    return [
      { x: from.x, y: from.y },
      { x: middleX, y: from.y },
      { x: middleX, y: to.y },
      { x: to.x, y: to.y },
    ];
  }
  const middleY = from.y + dy / 2;
  return [
    { x: from.x, y: from.y },
    { x: from.x, y: middleY },
    { x: to.x, y: middleY },
    { x: to.x, y: to.y },
  ];
}

/**
 * A line's centre line in its own frame: its two points, or for an elbow line its
 * {@link elbowRoute}. Pure.
 *
 * @param line - The line; only `points` and `route` are read.
 * @returns The polyline, first point first.
 */
export function lineRouteOf(line: Pick<LineObject, 'points' | 'route'>): Point[] {
  const [from, to] = line.points;
  return line.route === 'elbow'
    ? elbowRoute(from, to)
    : [
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      ];
}
