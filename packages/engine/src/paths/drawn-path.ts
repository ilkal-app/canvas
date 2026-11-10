import {
  freehandLocalBounds,
  type BoardObject,
  type ConnectorObject,
  type FreehandObject,
  type LineObject,
  type PathObject,
  type Point,
} from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { connectorLocalBounds, isSameConnectorMesh } from '../connectors/connector-mesh.js';
import { readFill } from '../paint/paint-reading.js';

import { isSameFreehandMesh } from './freehand-mesh.js';
import { isSameLineMesh, lineLocalBounds } from './line-mesh.js';
import { isSameStrokeStyle, strokeOutlineOf, strokeOutlineReach } from './stroke-outline.js';

// The objects the path pass draws and what their meshes depend on: which types they are, when
// two of them build the same mesh, and the box each draws inside (split from path-registry.ts).

/** An object the path pass draws: a path, a line or a placed connector. */
export type DrawnPath = PathObject | LineObject | ConnectorObject | FreehandObject;

/**
 * Whether two points are equal.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns True when both coordinates are.
 */
function isSamePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Whether two paths build the same mesh: the same vertices (id and position), segments (ends
 * and handles), stroke width, stroke style and fill flag. Colours, placement and mirror
 * modes do not matter.
 *
 * @param a - One path.
 * @param b - The other.
 * @returns True when their meshes are the same.
 */
export function isSameMeshInput(a: PathObject, b: PathObject): boolean {
  if ((a.stroke?.width ?? 0) !== (b.stroke?.width ?? 0)) return false;
  if (!isSameStrokeStyle(a, b)) return false;
  if ((readFill(a.fill) === null) !== (readFill(b.fill) === null)) return false;
  if (a.vertices !== b.vertices) {
    if (a.vertices.length !== b.vertices.length) return false;
    const isSame = a.vertices.every((vertex, index) => {
      const other = b.vertices[index];
      return vertex.id === other?.id && isSamePoint(vertex, other);
    });
    if (!isSame) return false;
  }
  if (a.segments === b.segments) return true;
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every((segment, index) => {
    const other = b.segments[index];
    return (
      segment.id === other?.id &&
      segment.a === other.a &&
      segment.b === other.b &&
      isSamePoint(segment.ha, other.ha) &&
      isSamePoint(segment.hb, other.hb)
    );
  });
}

/**
 * Whether two drawn objects build the same mesh (`isSameMeshInput` for paths, `isSameLineMesh`
 * for lines, `isSameConnectorMesh` for connectors); objects of different types never do.
 *
 * @param a - One object.
 * @param b - The other.
 * @returns True when their meshes are the same.
 */
export function isSameDrawnMesh(a: DrawnPath, b: DrawnPath): boolean {
  if (a.type === 'line') return b.type === 'line' && isSameLineMesh(a, b);
  if (a.type === 'connector') return b.type === 'connector' && isSameConnectorMesh(a, b);
  if (a.type === 'freehand') return b.type === 'freehand' && isSameFreehandMesh(a, b);
  return b.type === 'path' && isSameMeshInput(a, b);
}

/**
 * Whether an object is one the path pass draws.
 *
 * @param object - The object, if any.
 * @returns True for a path, a line, a connector or a freehand stroke.
 */
export function isDrawnPath(object: BoardObject | undefined): object is DrawnPath {
  const type = object?.type;
  return type === 'path' || type === 'line' || type === 'connector' || type === 'freehand';
}

/**
 * A box a drawn object's drawing stays inside, in its own frame.
 *
 * @param object - The path, line or connector.
 * @returns The box (`pathLocalBounds`, `lineLocalBounds`, `connectorLocalBounds`).
 */
export function drawnLocalBounds(object: DrawnPath): WorldBounds {
  if (object.type === 'line') return lineLocalBounds(object);
  if (object.type === 'connector') return connectorLocalBounds(object);
  if (object.type === 'freehand') {
    // The inked box: the curve grown by half the full width, which holds every pressure's.
    const { x, y, width, height } = freehandLocalBounds(object);
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  }
  return pathLocalBounds(object);
}

/**
 * A box a path's drawing stays inside, in its own frame: its vertices and Bézier handles (a
 * cubic lies inside the hull of its control points) grown by half the stroke width, or by more
 * for a square cap or a miter join (`strokeOutlineReach`).
 *
 * @param path - The path.
 * @returns The box.
 */
export function pathLocalBounds(path: PathObject): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const vertexById = new Map(path.vertices.map((vertex) => [vertex.id, vertex]));
  for (const { x, y } of path.vertices) grow(x, y);
  for (const { a, b, ha, hb } of path.segments) {
    const start = vertexById.get(a);
    const end = vertexById.get(b);
    if (start) grow(start.x + ha.x, start.y + ha.y);
    if (end) grow(end.x + hb.x, end.y + hb.y);
  }
  const reach = strokeOutlineReach(path.stroke?.width ?? 0, strokeOutlineOf(path));
  return { minX: minX - reach, minY: minY - reach, maxX: maxX + reach, maxY: maxY + reach };
}
