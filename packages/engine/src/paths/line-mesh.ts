import type { LineCap, LineObject, Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { flattenCubic, type Cubic } from './bezier.js';
import { capReach } from './caps.js';
import { lineRouteOf } from './elbow-route.js';
import { splitAroundGap, type LineGap } from './line-gap.js';
import { writeLineShape } from './line-shape.js';
import { assembleMesh, type PathMeshData } from './path-mesh.js';
import {
  isSameStrokeStyle,
  PLAIN_OUTLINE,
  roundJoined,
  strokeOutlineOf,
  strokeOutlineReach,
  type StrokeOutline,
} from './stroke-outline.js';
import { TriangleWriter } from './triangle-writer.js';

/**
 * What a line's mesh is built from, apart from its stroke width and the tolerance: its route and
 * caps. Plain data, structured-cloneable, so a `mesh` job carries it to a worker.
 */
export interface LineMeshShape {
  /**
   * The centre line in the line's own frame (`lineRouteOf`: the elbow route of an elbow line); for
   * a curved connector just its two ends, the `curve` giving the line.
   */
  readonly route: readonly Point[];
  /**
   * A curved connector's cubic, flattened at the build's tolerance in place of `route`, so the
   * curve is as smooth at every zoom bucket as a path's. Absent for lines.
   */
  readonly curve?: Cubic;
  /** The cap at the route's first point. */
  readonly startCap: LineCap;
  /** The cap at its last point. */
  readonly endCap: LineCap;
  /** Where the line breaks around its label (a connector's); absent for none. */
  readonly gap?: LineGap;
}

/** What {@link buildLineMesh} builds from. */
export interface LineMeshInput extends LineMeshShape {
  /** The stroke width, world units, above 0. */
  readonly strokeWidth: number;
  /** The largest allowed deviation from the exact outline, world units (the zoom bucket's). */
  readonly tolerance: number;
  /** The shaft's join, dash and cap (`strokeOutlineOf`); absent for none. */
  readonly outline?: StrokeOutline | undefined;
}

/**
 * The route and caps of a line, for its mesh.
 *
 * @param line - The line.
 * @returns Its mesh shape.
 */
export function lineMeshShapeOf(line: LineObject): LineMeshShape {
  return { route: lineRouteOf(line), startCap: line.startCap, endCap: line.endCap };
}

/**
 * Builds a line's mesh for the path pass: no fill, the cover
 * quad (which clears the stencil after a translucent stroke), then the shaft and heads as one
 * stroke layer (`writeLineShape`), so a translucent arrow (or a dashed shaft) covers each
 * pixel once; a curved connector's cubic is flattened at the tolerance first, and joins round
 * along it; a gap (a connector's label) leaves the stretch of the line through it out.
 * Pure: the work of a `mesh` job, like
 * `buildPathMesh`.
 *
 * @param input - The route, caps, stroke width and tolerance; not mutated.
 * @returns The mesh.
 */
export function buildLineMesh(input: LineMeshInput): PathMeshData {
  const stroke = new TriangleWriter();
  const route = input.curve ? flattenCubic(input.curve, input.tolerance) : input.route;
  const outline = input.outline ?? PLAIN_OUTLINE;
  // A curve has no corners: the points of its flattening join round, whatever the join style.
  const shape = { ...input, route, outline: input.curve ? roundJoined(outline) : outline };
  if (input.gap === undefined) {
    writeLineShape(stroke, shape, input.strokeWidth, input.tolerance);
  } else {
    // Broken around the label: each side keeps its true end's cap, none at the gap.
    const { before, after } = splitAroundGap(route, input.gap);
    for (const [part, startCap, endCap] of [
      [before, input.startCap, 'none'],
      [after, 'none', input.endCap],
    ] as const) {
      if (part.length < 2) continue;
      writeLineShape(
        stroke,
        { ...shape, route: part, startCap, endCap },
        input.strokeWidth,
        input.tolerance,
      );
    }
  }
  return assembleMesh(new Float32Array(0), stroke.toFloat32Array(), input.tolerance);
}

/**
 * A box a line's drawing stays inside, in its own frame: its route's box grown by the farther
 * reach of its caps (`capReach`), a whole stroke width, which covers the round joins of an elbow,
 * and its outline's reach (a square end or a miter join, `strokeOutlineReach`).
 *
 * @param line - The line.
 * @returns The box.
 */
export function lineLocalBounds(line: LineObject): WorldBounds {
  const width = line.stroke.width;
  const reach = Math.max(
    width,
    strokeOutlineReach(width, strokeOutlineOf(line)),
    capReach(line.startCap, width),
    capReach(line.endCap, width),
  );
  const [from, to] = line.points;
  return {
    minX: Math.min(from.x, to.x) - reach,
    minY: Math.min(from.y, to.y) - reach,
    maxX: Math.max(from.x, to.x) + reach,
    maxY: Math.max(from.y, to.y) + reach,
  };
}

/**
 * Whether two lines build the same mesh: the same points, route, caps, stroke width and stroke
 * style. Colour and placement do not matter.
 *
 * @param a - One line.
 * @param b - The other.
 * @returns True when their meshes are the same.
 */
export function isSameLineMesh(a: LineObject, b: LineObject): boolean {
  const [a0, a1] = a.points;
  const [b0, b1] = b.points;
  return (
    a.stroke.width === b.stroke.width &&
    isSameStrokeStyle(a, b) &&
    a.route === b.route &&
    a.startCap === b.startCap &&
    a.endCap === b.endCap &&
    a0.x === b0.x &&
    a0.y === b0.y &&
    a1.x === b1.x &&
    a1.y === b1.y
  );
}
