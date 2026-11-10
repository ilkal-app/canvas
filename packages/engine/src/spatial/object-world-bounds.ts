import {
  applyTransform,
  strokeOutsetOf,
  type BoardObject,
  type PathObject,
  type Point,
} from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { cubicOf } from '../paths/bezier.js';
import { strokeOutlineOf, strokeOutlineReach } from '../paths/stroke-outline.js';
import { frameRadiiOf, isRoundedFrame } from '../scene/frame-shape-record.js';
import type { WorldTransform } from '../scene/world-transform.js';
import { readShadowLayers, shadowMarginOf } from '../shapes/shape-shadow.js';
import { NOTE_SHADOW } from '../shapes/sticky-note.js';

import { boundsAround, expandBounds } from './bounds.js';
import type { OrientedBox } from './clip-chain.js';
import { objectGeometry, type BoxGeometry, type StrokeGeometry } from './object-geometry.js';

/**
 * How far a stroke may reach past its centre line, in stroke widths: a miter join up to a miter
 * limit of 4 reaches twice the width. Provisional until the path renderer fixes its joins.
 */
const STROKE_REACH_WIDTHS = 2;

type BoundsGeometry = BoxGeometry | Pick<StrokeGeometry, 'kind' | 'hullPoints' | 'strokeWidth'>;

/**
 * The world-space axis-aligned box an object draws inside: its geometry in its own frame
 * (`objectGeometry`, the schema's local bounds for every type but groups; a placed connector's
 * route and heads, `connectorGeometry`) mapped through its
 * world transform, so a rotated object gets the bounds of its rotated box, then grown by how far
 * its drawing reaches past its geometry (a stroke's half-width and joins, a sticky note's dropped
 * shadow, a shape's or frame's drop shadow, and its outline's part outside its edge;
 * a turned rounded frame's bounds are its rounded box's;
 * a line's heads are part of its geometry's hull points). The spatial index stores this box; culling must never drop anything
 * the renderer would draw, so it errs large.
 *
 * @param object - The object; not mutated.
 * @param transform - Its world transform (`worldTransformOf`).
 * @returns The box in world units, or `undefined` for an object with no geometry of its own (a
 *   group or comment) or with no points (an empty path).
 */
export function worldBoundsOf(
  object: BoardObject,
  transform: WorldTransform,
): WorldBounds | undefined {
  const geometry = object.type === 'path' ? pathBoundsGeometry(object) : objectGeometry(object);
  if (!geometry) return undefined;
  const bounds =
    geometry.kind === 'box'
      ? object.type === 'frame' && transform.sin !== 0 && isRoundedFrame(object)
        ? roundedBoxBounds(geometry, frameRadiiOf(object), transform)
        : transformedBoxBounds(geometry, transform)
      : boundsAround(geometry.hullPoints.map((point) => applyTransform(transform, point)));
  if (!bounds) return undefined;
  const margin = drawnMargin(object, geometry);
  return margin > 0 ? expandBounds(bounds, margin) : bounds;
}

/**
 * The shape an object draws inside, for clipping it: an object drawn in a box (a
 * shape, note, frame, image or text) that its world transform turns is that box grown by how far
 * its drawing reaches past it, turned with it, so a clip cuts the turned box rather than its
 * bounding box; anything else (an upright box, a line, path or connector) is its world bounds.
 *
 * @param object - The object; not mutated.
 * @param transform - Its world transform (`worldTransformOf`).
 * @param bounds - Its world bounds (`worldBoundsOf`).
 * @returns The oriented box, or `bounds` itself.
 */
export function drawnShapeOf(
  object: BoardObject,
  transform: WorldTransform,
  bounds: WorldBounds,
): WorldBounds | OrientedBox {
  if (transform.sin === 0) return bounds;
  const geometry = object.type === 'path' ? undefined : objectGeometry(object);
  if (geometry?.kind !== 'box') return bounds;
  const margin = drawnMargin(object, geometry);
  const { cos, sin, x, y } = transform;
  return {
    transform: { cos, sin, x: x - (cos - sin) * margin, y: y - (sin + cos) * margin },
    width: geometry.width + 2 * margin,
    height: geometry.height + 2 * margin,
  };
}

/**
 * Bounds a transformed box without temporary corner or transformed-point arrays.
 * Arithmetic and visitation match `boxCorners`, `applyTransform` and `boundsAround` exactly.
 *
 * @param geometry - The local box.
 * @param transform - The world transform.
 * @returns The same conservative bounds.
 */
function transformedBoxBounds(geometry: BoxGeometry, transform: WorldTransform): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < 4; index++) {
    const localX = index === 1 || index === 2 ? geometry.width : 0;
    const localY = index >= 2 ? geometry.height : 0;
    const x = transform.cos * localX - transform.sin * localY + transform.x;
    const y = transform.sin * localX + transform.cos * localY + transform.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Bounds a turned box whose corners are rounded (a rounded frame): the box is the
 * convex hull of its four corner circles (a sharp corner a point), so its bounds are those of the
 * circles' centres, turned, each grown by its radius. Tighter than the turned box's corners.
 *
 * @param geometry - The local box.
 * @param radii - Its corner radii, top-left clockwise, each at most half the shorter side.
 * @param transform - The world transform.
 * @returns The bounds.
 */
function roundedBoxBounds(
  geometry: BoxGeometry,
  radii: readonly [number, number, number, number],
  transform: WorldTransform,
): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  radii.forEach((radius, index) => {
    const isRight = index === 1 || index === 2;
    const isBottom = index >= 2;
    const localX = isRight ? geometry.width - radius : radius;
    const localY = isBottom ? geometry.height - radius : radius;
    const x = transform.cos * localX - transform.sin * localY + transform.x;
    const y = transform.sin * localX + transform.cos * localY + transform.y;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  });
  return { minX, minY, maxX, maxY };
}

/**
 * The corners of a box geometry, in its own frame.
 *
 * @param box - The box.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @returns The four corners, clockwise from the origin.
 */
export function boxCorners({ width, height }: { width: number; height: number }): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/**
 * How far an object's pixels reach past its geometry, world units.
 *
 * @param object - The object.
 * @param geometry - Its geometry.
 * @returns The margin, at least 0.
 */
function drawnMargin(object: BoardObject, geometry: BoundsGeometry): number {
  switch (object.type) {
    case 'sticky':
      // The shadow ends `offsetBottom` below the note and blurs `softness` further.
      return NOTE_SHADOW.offsetBottom + NOTE_SHADOW.softness;
    case 'shape':
    case 'frame': {
      // An outline outside the edge reaches past the box, and its shadow with it.
      const outset = strokeOutsetOf(object.stroke, object.strokeAlign);
      const halfStroke = object.type === 'shape' ? (object.stroke?.width ?? 0) / 2 : 0;
      return Math.max(halfStroke, outset, shadowMargin(object.shadow) + outset);
    }
    case 'path':
    case 'line':
    case 'connector':
      // A miter join past a limit of 4 reaches further.
      return Math.max(
        geometry.kind === 'strokes' ? STROKE_REACH_WIDTHS * geometry.strokeWidth : 0,
        strokeOutlineReach(
          geometry.kind === 'strokes' ? geometry.strokeWidth : 0,
          strokeOutlineOf(object),
        ),
      );
    case 'freehand':
      // Its hull is already its inked box, round caps and joins included.
      return 0;
    default:
      return geometry.kind === 'strokes' ? STROKE_REACH_WIDTHS * geometry.strokeWidth : 0;
  }
}

/**
 * How far a stored drop shadow reaches past its object's box: the largest margin
 * (`shadowMarginOf`) of the layers it would draw (`readShadowLayers`), else 0. It errs large: a shadow its object
 * does not draw (an unpainted shape's) still counts, and hit testing never reads it.
 *
 * @param value - The stored `shadow` field.
 * @returns The margin, world units.
 */
function shadowMargin(value: unknown): number {
  // A loop, not a mapped array: bounds are prepared without allocating.
  let margin = 0;
  for (const layer of readShadowLayers(value)) margin = Math.max(margin, shadowMarginOf(layer));
  return margin;
}

/**
 * Collects the same path control hull as picking geometry without flattening its curves.
 * Bounds need neither subdivided polylines nor filled-loop outlines or adjacency tables.
 *
 * @param path - The unchanged network.
 * @returns Control points in the original visitation order and the original stroke width.
 */
function pathBoundsGeometry(path: PathObject): BoundsGeometry {
  const vertexById = new Map(path.vertices.map((vertex) => [vertex.id, vertex]));
  const hullPoints = path.vertices.map(({ x, y }) => ({ x, y }));
  for (const segment of path.segments) {
    if (!vertexById.has(segment.a) || !vertexById.has(segment.b)) continue;
    const cubic = cubicOf({ vertexById }, segment);
    hullPoints.push(cubic[1], cubic[2]);
  }
  return { kind: 'strokes', hullPoints, strokeWidth: path.stroke?.width ?? 0 };
}
