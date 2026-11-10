import {
  freehandCurve,
  freehandPointsOf,
  type FreehandObject,
  type FreehandTool,
  type Point,
} from '@canvas/schema';

import { flattenCubic } from './bezier.js';
import { assembleMesh, type PathMeshData } from './path-mesh.js';
import { writeCap, writeDot } from './stroke-caps.js';
import { writeJoin, type Offset } from './stroke-joins.js';
import { TriangleWriter } from './triangle-writer.js';

// A freehand stroke's mesh: its curve (`freehandCurve`) flattened at the zoom
// bucket's tolerance, each flattened point with its own half-width, and a quad per segment
// between the two points' offsets. A marker's half-width follows the pen's pressure, linearly
// along each piece of the curve; a pencil and a highlighter are of one width. Turns join round,
// the ends are round (a highlighter's flat), and a stroke of one point is a disc. The quads,
// joins and caps overlap, which a translucent stroke's `strokeOnce` stencil draws once per
// sample (`path-layer-draws.ts`), so an overlapping highlighter does not darken.

/** The thinnest a marker draws, as a share of its width: at zero pressure. */
export const MARKER_MIN_WIDTH_SHARE = 0.3;

/** What a freehand stroke's mesh is built from. Plain data, so a `mesh` job carries it. */
export interface FreehandMeshShape {
  /** The stroke's stored points, flat x, y pairs in its own frame. */
  readonly points: readonly number[];
  /** One pressure per point, 0 to 1, for a marker; absent for one width. */
  readonly pressures?: readonly number[];
  /** Whether the ends are flat (a highlighter's) rather than round. */
  readonly isFlatEnded: boolean;
}

/** What {@link buildFreehandMesh} builds from. */
export interface FreehandMeshInput extends FreehandMeshShape {
  /** The stroke width at full pressure, world units, above 0. */
  readonly strokeWidth: number;
  /** The largest allowed deviation from the exact outline, world units (the zoom bucket's). */
  readonly tolerance: number;
}

/**
 * The mesh shape of a stroke: its points, a marker's pressures, and its ends.
 *
 * @param freehand - The stroke.
 * @returns Its mesh shape.
 */
export function freehandMeshShapeOf(
  freehand: Pick<FreehandObject, 'points' | 'pressures' | 'tool'>,
): FreehandMeshShape {
  const isFlatEnded = freehand.tool === 'highlighter';
  return freehand.tool === 'marker' && freehand.pressures !== undefined
    ? { points: freehand.points, pressures: freehand.pressures, isFlatEnded }
    : { points: freehand.points, isFlatEnded };
}

/**
 * The half-width a stroke draws at a pressure: half its width for a pencil or highlighter, and
 * for a marker from {@link MARKER_MIN_WIDTH_SHARE} of that at no pressure to all of it at full.
 *
 * @param tool - The look.
 * @param strokeWidth - The width at full pressure, world units.
 * @param pressure - The pressure, 0 to 1; absent for full.
 * @returns The half-width, world units.
 */
export function freehandHalfWidth(
  tool: FreehandTool,
  strokeWidth: number,
  pressure: number | undefined,
): number {
  if (tool !== 'marker' || pressure === undefined) return strokeWidth / 2;
  const share = MARKER_MIN_WIDTH_SHARE + (1 - MARKER_MIN_WIDTH_SHARE) * pressure;
  return (strokeWidth / 2) * share;
}

/** A flattened point of the stroke, with the half-width it draws at. */
interface WidePoint {
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
}

/**
 * The stroke flattened within the tolerance, each point with its half-width: a piece's pressure
 * runs linearly from its start's to its end's by the distance along its flattening. Repeated
 * points collapse.
 *
 * @param input - The points, pressures, width and tolerance.
 * @returns The flattened points; one for a dot.
 */
function widePointsOf(input: FreehandMeshInput): WidePoint[] {
  const tool: FreehandTool = input.pressures === undefined ? 'pencil' : 'marker';
  const widthAt = (pressure: number | undefined): number =>
    freehandHalfWidth(tool, input.strokeWidth, pressure);
  const stored = freehandPointsOf(input.points);
  const [first] = stored;
  if (first === undefined) return [];
  const result: WidePoint[] = [{ ...first, halfWidth: widthAt(input.pressures?.[0]) }];
  freehandCurve(input.points).forEach(({ from, c1, c2, to }, index) => {
    const line = flattenCubic([from, c1, c2, to], input.tolerance);
    const lengths = [0];
    for (let at = 1; at < line.length; at += 1) {
      const a = line[at - 1] ?? from;
      const b = line[at] ?? to;
      lengths.push((lengths.at(-1) ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = lengths.at(-1) ?? 0;
    const start = input.pressures?.[index];
    const end = input.pressures?.[index + 1];
    line.slice(1).forEach((point, offset) => {
      const along = total === 0 ? 1 : (lengths[offset + 1] ?? total) / total;
      const pressure =
        start === undefined || end === undefined ? undefined : start + (end - start) * along;
      const last = result.at(-1);
      if (last?.x === point.x && last.y === point.y) return;
      result.push({ x: point.x, y: point.y, halfWidth: widthAt(pressure) });
    });
  });
  return result;
}

/**
 * The unit direction from one point to the next.
 *
 * @param from - The start.
 * @param to - The end, not the start.
 * @returns The direction.
 */
function directionOf(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/**
 * Writes the quad of one segment between the offsets its ends take.
 *
 * @param writer - Where the triangles go.
 * @param from - The segment's start.
 * @param to - Its end.
 * @param start - The left offset at the start.
 * @param end - The left offset at the end.
 */
function writeQuad(
  writer: TriangleWriter,
  from: Point,
  to: Point,
  start: Offset,
  end: Offset,
): void {
  const [lx0, ly0, rx0, ry0] = [
    from.x + start.x,
    from.y + start.y,
    from.x - start.x,
    from.y - start.y,
  ];
  const [lx1, ly1, rx1, ry1] = [to.x + end.x, to.y + end.y, to.x - end.x, to.y - end.y];
  writer.triangle(lx0, ly0, rx0, ry0, rx1, ry1);
  writer.triangle(lx0, ly0, rx1, ry1, lx1, ly1);
}

/**
 * Builds a freehand stroke's mesh for the path pass: no fill, the cover quad (which clears the
 * stencil after a translucent stroke), then the stroke's quads, round joins and ends as one
 * stroke layer. Pure: the work of a `mesh` job, like `buildLineMesh`.
 *
 * @param input - The points, pressures, ends, width and tolerance; not mutated.
 * @returns The mesh; a disc for a stroke of one point, nothing for none.
 */
export function buildFreehandMesh(input: FreehandMeshInput): PathMeshData {
  const writer = new TriangleWriter();
  const points = widePointsOf(input);
  const cap = input.isFlatEnded ? 'butt' : 'round';
  const [first] = points;
  const last = points.at(-1);
  if (first !== undefined && last !== undefined && points.length === 1) {
    // A zero-length stroke draws only with a round end: a highlighter's dot is round too.
    writeDot(writer, 'round', first, { x: 1, y: 0 }, first.halfWidth, input.tolerance);
  } else if (first !== undefined && last !== undefined) {
    const directions = points
      .slice(1)
      .map((point, index) => directionOf(points[index] ?? first, point));
    let previous: Offset = normalOfWidth(directions[0], first.halfWidth);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1] ?? first;
      const to = points[index] ?? last;
      const incoming = directions[index - 1] ?? { x: 1, y: 0 };
      const outgoing = directions[index];
      if (outgoing === undefined) {
        writeQuad(writer, from, to, previous, normalOfWidth(incoming, to.halfWidth));
        break;
      }
      const [end, start] = writeJoin(
        writer,
        to,
        incoming,
        outgoing,
        to.halfWidth,
        input.tolerance,
        {
          join: 'round',
        },
      );
      writeQuad(writer, from, to, previous, end);
      previous = start;
    }
    const startOut = directions[0] ?? { x: 1, y: 0 };
    const endOut = directions.at(-1) ?? startOut;
    writeCap(
      writer,
      cap,
      first,
      { x: -startOut.x, y: -startOut.y },
      first.halfWidth,
      input.tolerance,
    );
    writeCap(writer, cap, last, endOut, last.halfWidth, input.tolerance);
  }
  return assembleMesh(new Float32Array(0), writer.toFloat32Array(), input.tolerance);
}

/**
 * The left normal of a direction at a half-width.
 *
 * @param direction - The unit direction; the x axis when absent.
 * @param halfWidth - The half-width.
 * @returns The offset.
 */
function normalOfWidth(direction: Point | undefined, halfWidth: number): Offset {
  const { x, y } = direction ?? { x: 1, y: 0 };
  return { x: -y * halfWidth, y: x * halfWidth };
}

/**
 * Whether two strokes build the same mesh: the same points, pressures (a marker's), width and
 * ends. Colour, opacity and placement do not matter.
 *
 * @param a - One stroke.
 * @param b - The other.
 * @returns True when their meshes are the same.
 */
export function isSameFreehandMesh(a: FreehandObject, b: FreehandObject): boolean {
  const shapeA = freehandMeshShapeOf(a);
  const shapeB = freehandMeshShapeOf(b);
  return (
    a.stroke.width === b.stroke.width &&
    shapeA.isFlatEnded === shapeB.isFlatEnded &&
    isSameNumbers(shapeA.points, shapeB.points) &&
    isSameNumbers(shapeA.pressures, shapeB.pressures)
  );
}

/**
 * Whether two number lists hold the same numbers (both absent counts as the same).
 *
 * @param a - One list.
 * @param b - The other.
 * @returns True when equal.
 */
function isSameNumbers(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === b) return true;
  if (a?.length !== b?.length || a === undefined || b === undefined) return false;
  return a.every((value, index) => value === b[index]);
}
