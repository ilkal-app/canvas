import {
  polygonFitOf,
  unitPolygonInradius,
  unitPolygonVertex,
  type ShapeVector,
} from '@canvas/text';

import type { ShapeKind } from './shape-instance.js';

// The unit polygon's geometry lives in @canvas/text, which fits shape labels for agents too;
// the renderer's distances below build on it.

export {
  polygonFitOf,
  STAR_INNER_SCALE,
  starInnerRadius,
  unitPolygonInradius,
  unitPolygonVertex,
} from '@canvas/text';
export type { PolygonFit, ShapeVector } from '@canvas/text';

/**
 * The exact signed distance from a point to a box with rounded corners about the origin:
 * negative inside. The shader's `roundedBoxDistance`. Pure.
 *
 * @param point - The point, relative to the box's centre.
 * @param halfSize - Half the box's width and height.
 * @param radius - The corner radius, at most the shorter half-side.
 * @returns The distance, world units.
 */
export function roundedBoxDistance(
  point: ShapeVector,
  halfSize: ShapeVector,
  radius: number,
): number {
  const qx = Math.abs(point.x) - halfSize.x + radius;
  const qy = Math.abs(point.y) - halfSize.y + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/**
 * The signed distance to an ellipse about the origin, as the shader's `ellipseDistance`
 * approximates it: the implicit function over its gradient's length, exact on the outline and
 * for a circle; a full semi-minor axis inside at the centre. Pure.
 *
 * @param point - The point, relative to the centre.
 * @param radii - The semi-axes.
 * @returns The distance, world units.
 */
export function ellipseDistance(point: ShapeVector, radii: ShapeVector): number {
  const k0 = Math.hypot(point.x / radii.x, point.y / radii.y);
  const k1 = Math.hypot(point.x / radii.x ** 2, point.y / radii.y ** 2);
  return k1 < 1e-6 ? -Math.min(radii.x, radii.y) : (k0 * (k0 - 1)) / k1;
}

/**
 * The exact signed distance to a regular polygon or star stretched to fill a box
 * ({@link polygonFitOf}): the distance to its nearest edge, negative inside by the crossing rule
 * (Inigo Quilez's `sdPolygon`, iquilezles.org/articles/distfunctions2d). A diamond is the
 * four-sided polygon. The shader's `polygonDistance`, which walks the same vertices. Pure.
 *
 * @param point - The point, relative to the box's centre.
 * @param halfSize - Half the box's width and height.
 * @param sides - The polygon's sides or the star's points, 3 to 64.
 * @param isStar - Whether it is a star.
 * @returns The distance, world units.
 */
export function polygonDistance(
  point: ShapeVector,
  halfSize: ShapeVector,
  sides: number,
  isStar: boolean,
): number {
  const { centre, scale } = polygonFitOf(halfSize, sides, isStar);
  const count = isStar ? 2 * sides : sides;
  const place = (index: number): ShapeVector => {
    const unit = unitPolygonVertex(index % count, sides, isStar);
    return { x: (unit.x - centre.x) * scale.x, y: (unit.y - centre.y) * scale.y };
  };
  let squared = Infinity;
  let sign = 1;
  let previous = place(count - 1);
  for (let index = 0; index < count; index += 1) {
    const vertex = place(index);
    const edge = { x: previous.x - vertex.x, y: previous.y - vertex.y };
    const toPoint = { x: point.x - vertex.x, y: point.y - vertex.y };
    const along = (toPoint.x * edge.x + toPoint.y * edge.y) / (edge.x ** 2 + edge.y ** 2);
    const t = Math.min(1, Math.max(0, along));
    squared = Math.min(squared, (toPoint.x - edge.x * t) ** 2 + (toPoint.y - edge.y * t) ** 2);
    const isAbove = point.y >= vertex.y;
    const isBelow = point.y < previous.y;
    const isLeft = edge.x * toPoint.y > edge.y * toPoint.x;
    if ((isAbove && isBelow && isLeft) || (!isAbove && !isBelow && !isLeft)) sign = -sign;
    previous = vertex;
  }
  return sign * Math.sqrt(squared);
}

/**
 * The squared distance from a point to a segment.
 *
 * @param point - The point.
 * @param start - The segment's start.
 * @param end - Its end.
 * @returns The squared distance.
 */
function segmentDistanceSquared(point: ShapeVector, start: ShapeVector, end: ShapeVector): number {
  const edge = { x: end.x - start.x, y: end.y - start.y };
  const along =
    ((point.x - start.x) * edge.x + (point.y - start.y) * edge.y) / (edge.x ** 2 + edge.y ** 2);
  const t = Math.min(1, Math.max(0, along));
  return (point.x - start.x - edge.x * t) ** 2 + (point.y - start.y - edge.y * t) ** 2;
}

/**
 * The shader's distance to a stretched polygon or star (fix round 1): exact wherever it is
 * under `band`, at least `band` elsewhere, walking only the edges that can be that near. In the
 * unit polygon's space the shape is regular about the origin and every ray from it crosses the
 * outline once, so the point's angular sector names one edge, whose side gives the sign; an edge
 * m sectors away is at least ρ·sin((m − 1)·step) away there (ρ the point's distance from the
 * centre), and at least that times the smaller stretch in the world, so the walk stops where that
 * bound passes `band`. A point inside the largest centred circle deeper than `band` is answered by
 * that circle. The fragment shader's `polygonDistance` computes the same with `band` the outline's
 * width plus a device pixel, all its coverage depends on. Pure.
 *
 * @param point - The point, relative to the box's centre.
 * @param halfSize - Half the box's width and height.
 * @param sides - The polygon's sides or the star's points, 3 to 64.
 * @param isStar - Whether it is a star.
 * @param band - How far from the outline the distance must be exact, world units, above 0.
 * @returns The distance, world units; negative inside.
 */
export function bandedPolygonDistance(
  point: ShapeVector,
  halfSize: ShapeVector,
  sides: number,
  isStar: boolean,
  band: number,
): number {
  const { centre, scale } = polygonFitOf(halfSize, sides, isStar);
  const count = isStar ? 2 * sides : sides;
  const step = isStar ? Math.PI / sides : (2 * Math.PI) / sides;
  const unit = { x: point.x / scale.x + centre.x, y: point.y / scale.y + centre.y };
  const turned = Math.atan2(unit.x, -unit.y);
  const sector = Math.min(
    Math.floor((turned < 0 ? turned + 2 * Math.PI : turned) / step),
    count - 1,
  );
  const place = (index: number): ShapeVector => {
    const vertex = unitPolygonVertex(index - count * Math.floor(index / count), sides, isStar);
    return { x: (vertex.x - centre.x) * scale.x, y: (vertex.y - centre.y) * scale.y };
  };
  const edgeSquared = (index: number): number =>
    segmentDistanceSquared(point, place(index), place(index + 1));
  const start = place(sector);
  const end = place(sector + 1);
  const side = (at: ShapeVector): number =>
    (end.x - start.x) * (at.y - start.y) - (end.y - start.y) * (at.x - start.x);
  const isInside = side(point) * side({ x: -centre.x * scale.x, y: -centre.y * scale.y }) >= 0;
  const smallerScale = Math.min(scale.x, scale.y);
  const radius = Math.hypot(unit.x, unit.y);
  const depth = (unitPolygonInradius(sides, isStar) - radius) * smallerScale;
  if (isInside && depth >= band) return -depth;
  const near = radius * smallerScale;
  const spread = band < near ? Math.asin(band / near) : Math.PI;
  const reach = Math.min(Math.floor(count / 2), Math.ceil(spread / step) + 1);
  let squared = edgeSquared(sector);
  for (let offset = 1; offset <= reach; offset += 1) {
    squared = Math.min(squared, edgeSquared(sector - offset), edgeSquared(sector + offset));
  }
  return (isInside ? -1 : 1) * Math.sqrt(squared);
}

/**
 * The signed distance to a shape instance's outline, by kind, as the fragment shader picks it.
 * Pure.
 *
 * @param kind - The distance function.
 * @param point - The point, relative to the box's centre.
 * @param halfSize - Half the box's width and height.
 * @param radius - A rounded box's corner radius (the caller clamps it).
 * @param sides - A polygon's sides or a star's points; ignored by the other kinds.
 * @returns The distance, world units; negative inside.
 */
export function shapeDistance(
  kind: ShapeKind,
  point: ShapeVector,
  halfSize: ShapeVector,
  radius: number,
  sides: number,
): number {
  switch (kind) {
    case 'rounded-box':
      return roundedBoxDistance(point, halfSize, radius);
    case 'ellipse':
      return ellipseDistance(point, halfSize);
    case 'diamond':
      return polygonDistance(point, halfSize, 4, false);
    case 'polygon':
      return polygonDistance(point, halfSize, sides, false);
    case 'star':
      return polygonDistance(point, halfSize, sides, true);
  }
}

/**
 * The signed distance to where an outline reaching `outward` past a shape's edge ends,
 * as the shader's `outlineOuterDistance` draws it: a rounded box is grown by `outward`, so
 * a rounded corner's radius grows with it and a sharp corner stays sharp (a mitre); every other
 * kind offsets its distance, so its corners (a polygon's, a star's points, a diamond's) round by
 * `outward` (by design; mitred outer corners for those kinds are). Pure.
 *
 * @param kind - The shape's kind.
 * @param point - The point, relative to the box's centre.
 * @param halfSize - Half the box's width and height.
 * @param radius - The corner radius, at most the shorter half-side (rounded boxes only).
 * @param distance - {@link shapeDistance} at the point.
 * @param outward - How far the outline reaches past the edge, world units, at least 0.
 * @returns The distance, world units, negative inside the outline's outer edge.
 */
export function outlineOuterDistance(
  kind: ShapeKind,
  point: ShapeVector,
  halfSize: ShapeVector,
  radius: number,
  distance: number,
  outward: number,
): number {
  if (kind !== 'rounded-box') return distance - outward;
  const grown = { x: halfSize.x + outward, y: halfSize.y + outward };
  return roundedBoxDistance(point, grown, radius > 0 ? radius + outward : 0);
}
