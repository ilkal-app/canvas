// The geometry of regular polygons and stars inscribed in a shape's box,
// which the renderer draws with and shape labels are fitted to.

/** A 2D vector, world units unless said otherwise. */
export interface ShapeVector {
  /** Across, world units. */
  readonly x: number;
  /** Down, world units. */
  readonly y: number;
}

/**
 * A star's inner vertices sit at this fraction of its outer polygon's apothem (`cos(π/n)`), so a
 * star of any number of points stays concave: 0.4 of the radius for five points, near the
 * classic pentagram's 0.38, and never on the outer polygon's edges (a three-point star is not a
 * triangle).
 */
export const STAR_INNER_SCALE = 0.5;

/**
 * The radius of a star's inner vertices, as a fraction of its points' radius. Pure.
 *
 * @param points - The star's points, 3 to 64.
 * @returns The fraction, in (0, 0.5).
 */
export function starInnerRadius(points: number): number {
  return STAR_INNER_SCALE * Math.cos(Math.PI / points);
}

/**
 * Vertex `index` of a regular polygon or star of unit radius about the origin, the first at the
 * top and the rest clockwise (y down): a polygon's `sides` vertices, or a star's `2 × points`,
 * points and inner vertices alternating. The shader's `unitPolygonVertex` computes the same. Pure.
 *
 * @param index - Which vertex, from 0.
 * @param sides - The polygon's sides or the star's points.
 * @param isStar - Whether it is a star.
 * @returns The vertex, in the unit polygon's space.
 */
export function unitPolygonVertex(index: number, sides: number, isStar: boolean): ShapeVector {
  const step = isStar ? Math.PI / sides : (2 * Math.PI) / sides;
  const angle = index * step;
  const radius = isStar && index % 2 === 1 ? starInnerRadius(sides) : 1;
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** How a unit polygon is placed in a shape's box: `local = (unit − centre) × scale`. */
export interface PolygonFit {
  /** The centre of the unit polygon's bounds, in its own space. */
  readonly centre: ShapeVector;
  /** World units per unit, on each axis. */
  readonly scale: ShapeVector;
}

/**
 * How a regular polygon or star is stretched to fill a box: its vertices' bounds mapped onto the
 * box, so a triangle's apex touches the top and its base the bottom, whatever the box's aspect.
 * The shader fits it the same way,
 * per instance, in the vertex stage. Pure.
 *
 * @param halfSize - Half the box's width and height, world units.
 * @param sides - The polygon's sides or the star's points.
 * @param isStar - Whether it is a star.
 * @returns The fit.
 */
export function polygonFitOf(halfSize: ShapeVector, sides: number, isStar: boolean): PolygonFit {
  const count = isStar ? 2 * sides : sides;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const vertex = unitPolygonVertex(index, sides, isStar);
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    scale: { x: (2 * halfSize.x) / (maxX - minX), y: (2 * halfSize.y) / (maxY - minY) },
  };
}

/**
 * The radius of the largest circle about a unit polygon's or star's centre that stays inside it:
 * the distance from the origin to its nearest edge. Pure.
 *
 * @param sides - The polygon's sides or the star's points.
 * @param isStar - Whether it is a star.
 * @returns The radius, in the unit polygon's space.
 */
export function unitPolygonInradius(sides: number, isStar: boolean): number {
  const count = isStar ? 2 * sides : sides;
  let nearest = Infinity;
  let previous = unitPolygonVertex(count - 1, sides, isStar);
  for (let index = 0; index < count; index += 1) {
    const vertex = unitPolygonVertex(index, sides, isStar);
    const edge = { x: previous.x - vertex.x, y: previous.y - vertex.y };
    const along = -(vertex.x * edge.x + vertex.y * edge.y) / (edge.x ** 2 + edge.y ** 2);
    const t = Math.min(1, Math.max(0, along));
    nearest = Math.min(nearest, Math.hypot(vertex.x + edge.x * t, vertex.y + edge.y * t));
    previous = vertex;
  }
  return nearest;
}
