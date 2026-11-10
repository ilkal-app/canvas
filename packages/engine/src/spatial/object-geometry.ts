import {
  fittedImageRect,
  flattenFreehand,
  freehandLocalBounds,
  freehandPointsOf,
  type BoardObject,
  type FreehandObject,
  type ConnectorObject,
  type LineCap,
  type LineObject,
  type PathObject,
  type Point,
  type Rect,
} from '@canvas/schema';

import { connectorLabelSize, LABEL_GAP_PADDING } from '../connectors/connector-mesh.js';
import { connectorShapeOf } from '../connectors/connector-shape.js';
import { readFill } from '../paint/paint-reading.js';
import { cubicOf, flattenCubic } from '../paths/bezier.js';
import type { CapShape } from '../paths/caps.js';
import { closedLoops, flattenChain, loopCubics } from '../paths/chains.js';
import { lineRouteOf } from '../paths/elbow-route.js';
import { flattenToleranceOf } from '../paths/flatten-bucket.js';
import { lineShapeOf } from '../paths/line-shape.js';
import { indexNetwork } from '../paths/network-index.js';

/**
 * The flattening tolerance of geometry asked for without a zoom (bounds, marquees): the
 * renderer's tolerance at zoom 1, a quarter of a world unit.
 */
export const DEFAULT_GEOMETRY_TOLERANCE = flattenToleranceOf(0);

/** An object that fills its stored box: (0, 0) to (`width`, `height`) in its own frame. */
export interface BoxGeometry {
  /** The discriminator. */
  readonly kind: 'box';
  /** The box width, world units. */
  readonly width: number;
  /** The box height, world units. */
  readonly height: number;
}

/** An object drawn as strokes, and for a filled path an even-odd fill, in its own frame. */
export interface StrokeGeometry {
  /** The discriminator. */
  readonly kind: 'strokes';
  /** The centre lines, curves flattened as the path pass flattens them (`flattenCubic`). */
  readonly polylines: readonly (readonly Point[])[];
  /**
   * Points whose bounds contain every curve exactly: the vertices and the Bézier control points
   * (a cubic lies inside the hull of its control points), as the schema's `localBounds` uses.
   */
  readonly hullPoints: readonly Point[];
  /** The stroke width, world units; 0 without a stroke. */
  readonly strokeWidth: number;
  /**
   * The filled regions' outlines, even-odd: a filled path's closed loops, flattened. Empty for
   * a line, an unfilled path or a branching network, which the renderer does not fill.
   */
  readonly fillPolygons: readonly (readonly Point[])[];
  /**
   * A connector's label box (item 5): its laid-out text and the gap its line leaves around
   * it, picked as a box so the label is a hit target; absent without a label.
   */
  readonly labelBox?: Rect;
}

/** The exact geometry spatial queries refine their candidates with. */
export type ObjectGeometry = BoxGeometry | StrokeGeometry;

/**
 * An object's geometry in its own frame: boxed types (shape, sticky,
 * text, image, video, frame) fill their box; a line is its polyline; a path is its flattened
 * segments and, when filled, its closed loops; a connector is the route and heads it was placed
 * with (`connectorGeometry`: its geometry follows its targets, so a reader must hand the placed
 * value, `ConnectorPlacements`, to pick or bound it where it is drawn). Groups have
 * none of their own (their bounds derive from their children, which are indexed
 * individually), and nor do comments.
 *
 * A line is its route (`lineRouteOf`: an elbow line through `elbowRoute`, as the path pass draws
 * it) and its heads (`lineShapeOf`): an open arrow's barbs are polylines, filled caps are fill
 * polygons, so a head is picked and bounded where it is drawn.
 *
 * @param object - The object; not mutated.
 * @param tolerance - How closely curves are flattened, world units; default
 *   {@link DEFAULT_GEOMETRY_TOLERANCE}. Hit testing passes the tolerance of the zoom's bucket.
 * @returns Its geometry, or `undefined` for objects without geometry of their own.
 */
export function objectGeometry(
  object: BoardObject,
  tolerance = DEFAULT_GEOMETRY_TOLERANCE,
): ObjectGeometry | undefined {
  switch (object.type) {
    case 'line':
      return lineGeometry(object);
    case 'path':
      return pathGeometry(object, tolerance);
    case 'freehand':
      return freehandGeometry(object, tolerance);
    case 'connector':
      return connectorGeometry(object, tolerance);
    case 'group':
    case 'comment':
      return undefined;
    default:
      return { kind: 'box', width: object.width, height: object.height };
  }
}

/**
 * The rectangle a boxed object is picked by, in its own frame: an image's drawn rectangle
 * (`fittedImageRect`: the crop at its own aspect, fitted in a box a merge left off it),
 * so a press on the empty part of such a box misses it as the pixels do; any other object's
 * box. Bounds keep the whole box, which contains it. Pure.
 *
 * @param object - The object.
 * @param box - Its box geometry.
 * @returns The rectangle, world units in the object's frame.
 */
export function pickRectOf(object: BoardObject, box: BoxGeometry): Rect {
  if (object.type === 'image') return fittedImageRect(object);
  return { x: 0, y: 0, width: box.width, height: box.height };
}

/** Sides of the polygon a circle cap is picked by: close enough to its disc at any zoom. */
const DISC_SIDES = 16;

/**
 * A line's geometry: its route, and its heads as the path pass draws them (`lineShapeOf`).
 *
 * @param line - The line.
 * @returns Its geometry.
 */
function lineGeometry(line: LineObject): StrokeGeometry {
  return routeGeometry(lineRouteOf(line), [], line.startCap, line.endCap, line.stroke.width);
}

/**
 * A placed connector's geometry: its route (a curved route flattened as the path pass
 * flattens it, its control points in the hull), its heads and, with a label, its label box (
 * item 5: the label as laid out and {@link LABEL_GAP_PADDING} round it, in the hull too), from the shape the renderer placed
 * it with (`connectorShapeOf`). The spatial index bounds connectors by it, so they are culled
 * like any object.
 *
 * @param connector - The placed connector.
 * @param tolerance - The flattening tolerance, world units; default
 *   {@link DEFAULT_GEOMETRY_TOLERANCE}.
 * @returns Its geometry.
 */
export function connectorGeometry(
  connector: ConnectorObject,
  tolerance = DEFAULT_GEOMETRY_TOLERANCE,
): StrokeGeometry {
  const { path, label } = connectorShapeOf(connector);
  const route = path.curve ? flattenCubic(path.curve, tolerance) : [...path.route];
  const { startCap, endCap, stroke } = connector;
  const geometry = routeGeometry(route, path.curve ?? [], startCap, endCap, stroke.width);
  const size = connectorLabelSize(connector);
  if (size === undefined) return geometry;
  // The label and its line's gap, the label's padding round its text (item 5).
  const width = size.width + 2 * LABEL_GAP_PADDING;
  const height = size.height + 2 * LABEL_GAP_PADDING;
  const labelBox = { x: label.x - width / 2, y: label.y - height / 2, width, height };
  const hullPoints = [
    ...geometry.hullPoints,
    { x: labelBox.x, y: labelBox.y },
    { x: labelBox.x + width, y: labelBox.y + height },
  ];
  return { ...geometry, hullPoints, labelBox };
}

/**
 * The geometry of a stroked route with caps: the route, its heads (`lineShapeOf`), and every
 * point bounding the drawing.
 *
 * @param route - The centre line.
 * @param hull - Extra points bounding it (a curve's control points).
 * @param startCap - The cap at its first point.
 * @param endCap - The cap at its last point.
 * @param width - The stroke width.
 * @returns The geometry.
 */
function routeGeometry(
  route: Point[],
  hull: readonly Point[],
  startCap: LineCap,
  endCap: LineCap,
  width: number,
): StrokeGeometry {
  const { heads } = lineShapeOf({ route, startCap, endCap }, width);
  const polylines: Point[][] = [route];
  const fillPolygons: Point[][] = [];
  const hullPoints: Point[] = [...route, ...hull];
  for (const head of heads) addHead(head, polylines, fillPolygons, hullPoints);
  return { kind: 'strokes', polylines, hullPoints, strokeWidth: width, fillPolygons };
}

/**
 * Adds one head of a line to its geometry: barbs as a polyline, a filled polygon as a fill
 * polygon, a disc as a polygon of {@link DISC_SIDES} sides, bounded by its axis extremes.
 *
 * @param head - The head.
 * @param polylines - The stroked polylines; added to.
 * @param fillPolygons - The filled outlines; added to.
 * @param hullPoints - The points bounding the drawing; added to.
 */
function addHead(
  head: CapShape,
  polylines: Point[][],
  fillPolygons: Point[][],
  hullPoints: Point[],
): void {
  if (head.kind === 'disc') {
    const { centre, radius } = head;
    const polygon = Array.from({ length: DISC_SIDES + 1 }, (unused, step) => {
      const angle = (2 * Math.PI * step) / DISC_SIDES;
      return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
    });
    fillPolygons.push(polygon);
    hullPoints.push(
      { x: centre.x - radius, y: centre.y - radius },
      { x: centre.x + radius, y: centre.y + radius },
    );
    return;
  }
  const points = [...head.points];
  if (head.kind === 'stroke') polylines.push(points);
  // A closed ring, so the even-odd test counts the closing edge.
  else if (points[0]) fillPolygons.push([...points, points[0]]);
  hullPoints.push(...points);
}

/**
 * A freehand stroke's geometry: its curve (`freehandCurve`) flattened to the tolerance
 * as one polyline, its inked box (`freehandLocalBounds`: the curve grown by half the width, as
 * the schema bounds it) as the hull, and its width, so picking measures the distance to the centre line against half the width plus the
 * pointer's slop and a thin stroke is still picked. A dot is its one point.
 *
 * @param freehand - The stroke.
 * @param tolerance - The flattening tolerance, world units.
 * @returns Its geometry.
 */
function freehandGeometry(freehand: FreehandObject, tolerance: number): StrokeGeometry {
  const polyline = freehandPointsOf(flattenFreehand(freehand.points, tolerance));
  const box = freehandLocalBounds(freehand);
  const hullPoints: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
  ];
  return {
    kind: 'strokes',
    polylines: [polyline],
    hullPoints,
    strokeWidth: freehand.stroke.width,
    fillPolygons: [],
  };
}

/**
 * A path's geometry: each segment flattened to the tolerance with the renderer's
 * `flattenCubic`, so picking and drawing agree, and for a filled path the polygons of its
 * closed loops, the regions the renderer fills (a branching network has none).
 *
 * @param path - The path.
 * @param tolerance - The flattening tolerance, world units.
 * @returns Its geometry.
 */
function pathGeometry(path: PathObject, tolerance: number): StrokeGeometry {
  const index = indexNetwork(path);
  const polylines: Point[][] = [];
  const hullPoints: Point[] = path.vertices.map(({ x, y }) => ({ x, y }));
  for (const segment of path.segments) {
    if (!index.vertexById.has(segment.a) || !index.vertexById.has(segment.b)) continue;
    const cubic = cubicOf(index, segment);
    hullPoints.push(cubic[1], cubic[2]);
    polylines.push(flattenCubic(cubic, tolerance));
  }
  const fillPolygons =
    readFill(path.fill) === null
      ? []
      : closedLoops(index).map((loop) => flattenChain(loopCubics(index, loop), tolerance));
  return {
    kind: 'strokes',
    polylines,
    hullPoints,
    strokeWidth: path.stroke?.width ?? 0,
    fillPolygons,
  };
}
