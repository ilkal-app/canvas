import type { Point } from '@canvas/schema';

import { dashPieces, polylineLength, type CorneredPolyline } from './dash-pieces.js';
import {
  resolveCaps,
  writeCap,
  writeDot,
  writeSector,
  type StrokeCapOption,
  type StrokeCaps,
} from './stroke-caps.js';
import { dashIntervals } from './stroke-dash.js';
import { normalOf, writeJoin, type JoinStyle, type Offset } from './stroke-joins.js';
import { PLAIN_OUTLINE, type StrokeOutline } from './stroke-outline.js';
import { TriangleWriter } from './triangle-writer.js';

/** The join of a point that is not a corner (inside a flattened curve): round, as ever. */
const ROUND_JOIN: JoinStyle = Object.freeze({});

/** A polyline with repeated points removed, ready to stroke. */
interface StrokeLine {
  readonly points: readonly Point[];
  /** Per point, whether the join style applies there; absent: everywhere. */
  readonly corners: readonly boolean[] | undefined;
  /** Unit direction of each segment; segment `s` runs from point `s` to the next. */
  readonly directions: readonly Point[];
  readonly isClosed: boolean;
}

/**
 * The points to stroke: consecutive repeats dropped (a dropped point's corner flag kept on the
 * one it repeats), and on a closed polyline a last point that repeats the first.
 *
 * @param line - The centre line and its corners; not mutated.
 * @param isClosed - Whether it closes back to its first point.
 * @returns The distinct points and their corners.
 */
function distinctPoints(line: CorneredPolyline, isClosed: boolean): CorneredPolyline {
  const points: Point[] = [];
  const corners: boolean[] = [];
  line.points.forEach((point, index) => {
    const isCorner = line.corners?.[index] ?? true;
    const last = points.at(-1);
    if (last?.x !== point.x || last.y !== point.y) {
      points.push(point);
      corners.push(isCorner);
    } else {
      // The repeat's flag joins the point it repeats.
      corners.push(corners.pop() === true || isCorner);
    }
  });
  const first = points[0];
  const last = points.at(-1);
  if (isClosed && points.length > 1 && first?.x === last?.x && first?.y === last?.y) {
    points.pop();
    const isClosingCorner = corners.pop() === true;
    corners[0] = corners[0] === true || isClosingCorner;
  }
  return { points, corners: line.corners === undefined ? undefined : corners };
}

function strokeLineOf(line: CorneredPolyline, isClosed: boolean): StrokeLine {
  const { points } = line;
  const segmentCount = isClosed ? points.length : points.length - 1;
  const directions = Array.from({ length: segmentCount }, (unused, index) => {
    const from = points[index] ?? { x: 0, y: 0 };
    const to = points[(index + 1) % points.length] ?? from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    return { x: dx / length, y: dy / length };
  });
  return { points, corners: line.corners, directions, isClosed };
}

function writeSegments(
  writer: TriangleWriter,
  line: StrokeLine,
  endOffsets: readonly Offset[],
  startOffsets: readonly Offset[],
): void {
  const { points, directions } = line;
  directions.forEach((unused, segment) => {
    const next = (segment + 1) % points.length;
    const a = points[segment];
    const b = points[next];
    const oa = startOffsets[segment];
    const ob = endOffsets[next];
    if (!a || !b || !oa || !ob) return;
    writer.triangle(a.x + oa.x, a.y + oa.y, a.x - oa.x, a.y - oa.y, b.x + ob.x, b.y + ob.y);
    writer.triangle(a.x - oa.x, a.y - oa.y, b.x - ob.x, b.y - ob.y, b.x + ob.x, b.y + ob.y);
  });
}

/**
 * Writes the joins, caps and segment quads of a polyline with at least two points.
 *
 * @param writer - Where the triangles go.
 * @param line - The polyline, its corners and segment directions.
 * @param halfWidth - Half the stroke's width.
 * @param caps - The caps of an open line.
 * @param tolerance - The largest allowed deviation from the exact outline.
 * @param join - The join at corners.
 */
function writeLine(
  writer: TriangleWriter,
  line: StrokeLine,
  halfWidth: number,
  caps: StrokeCaps,
  tolerance: number,
  join: JoinStyle,
): void {
  const { points, directions, isClosed } = line;
  const segmentCount = directions.length;
  // Per point: the offset the segment arriving there ends with, and the one leaving starts with.
  const endOffsets: Offset[] = [];
  const startOffsets: Offset[] = [];
  points.forEach((point, index) => {
    const incoming =
      isClosed || index > 0 ? directions[(index - 1 + segmentCount) % segmentCount] : undefined;
    const outgoing =
      isClosed || index < points.length - 1 ? directions[index % segmentCount] : undefined;
    if (incoming && outgoing) {
      const style = (line.corners?.[index] ?? true) ? join : ROUND_JOIN;
      const [end, start] = writeJoin(
        writer,
        point,
        incoming,
        outgoing,
        halfWidth,
        tolerance,
        style,
      );
      endOffsets.push(end);
      startOffsets.push(start);
    } else if (outgoing) {
      startOffsets.push(normalOf(outgoing, halfWidth));
      endOffsets.push(normalOf(outgoing, halfWidth));
      writeCap(writer, caps.start, point, { x: -outgoing.x, y: -outgoing.y }, halfWidth, tolerance);
    } else if (incoming) {
      startOffsets.push(normalOf(incoming, halfWidth));
      endOffsets.push(normalOf(incoming, halfWidth));
      writeCap(writer, caps.end, point, incoming, halfWidth, tolerance);
    }
  });
  writeSegments(writer, line, endOffsets, startOffsets);
}

/**
 * Writes a lone point: a dot when either end would be round (or the stroke is closed), else a
 * square when either is square, else nothing.
 *
 * @param writer - Where the triangles go.
 * @param point - The point.
 * @param halfWidth - Half the stroke's width.
 * @param caps - The caps of the ends.
 * @param isClosed - Whether the stroke is closed.
 * @param tolerance - The largest allowed deviation.
 */
function writeLonePoint(
  writer: TriangleWriter,
  point: Point,
  halfWidth: number,
  caps: StrokeCaps,
  isClosed: boolean,
  tolerance: number,
): void {
  if (isClosed || caps.start === 'round' || caps.end === 'round') {
    // A multiple of four sides puts vertices on both axes, so the dot's bounds are exact.
    writeSector(writer, point, halfWidth, 0, 2 * Math.PI, tolerance, 4);
  } else if (caps.start === 'square' || caps.end === 'square') {
    writeDot(writer, 'square', point, { x: 1, y: 0 }, halfWidth, tolerance);
  }
}

/**
 * Writes a dashed polyline: each dash a piece of it, stroked open with the outline's
 * joins; a dash's ends take the outline's cap, except where it starts or ends at the stroke's own
 * open end, which keeps that end's cap; a dash of length 0 is a dot.
 *
 * @param writer - Where the triangles go.
 * @param line - The distinct points and their corners, at least two.
 * @param isClosed - Whether it closes back to its first point.
 * @param halfWidth - Half the stroke's width.
 * @param caps - The stroke's own end caps.
 * @param tolerance - The largest allowed deviation.
 * @param outline - The outline, with a dash.
 * @returns False when the dash is drawn solid instead (`dashIntervals`), having written nothing.
 */
function writeDashes(
  writer: TriangleWriter,
  line: CorneredPolyline,
  isClosed: boolean,
  halfWidth: number,
  caps: StrokeCaps,
  tolerance: number,
  outline: StrokeOutline & { readonly dash: NonNullable<StrokeOutline['dash']> },
): boolean {
  const length = polylineLength(line.points, isClosed);
  const dashes = dashIntervals(length, outline.dash);
  const [only] = dashes ?? [];
  if (!dashes || (isClosed && dashes.length === 1 && only && only[0] <= 0 && only[1] >= length)) {
    return false;
  }
  const dashCap = outline.cap ?? 'round';
  for (const piece of dashPieces(line, isClosed, dashes)) {
    if (piece.kind === 'dot') {
      writeDot(writer, dashCap, piece.point, piece.direction, halfWidth, tolerance);
      continue;
    }
    const pieceCaps = {
      start: piece.isAtStart ? caps.start : dashCap,
      end: piece.isAtEnd ? caps.end : dashCap,
    };
    const points = distinctPoints(piece.line, false);
    if (points.points.length > 1) {
      writeLine(writer, strokeLineOf(points, false), halfWidth, pieceCaps, tolerance, outline);
    }
  }
  return true;
}

/**
 * Writes a stroked polyline's triangles into a writer; {@link strokeMesh} without the copy, for
 * builders that concatenate several strokes.
 *
 * @param writer - Where the triangles go.
 * @param polyline - The centre line, world units; not mutated.
 * @param width - The stroke's width, world units, at least 0.
 * @param isClosed - Whether the last point joins back to the first (no caps).
 * @param capStyle - The caps of an open stroke's ends.
 * @param tolerance - The largest allowed deviation from the exact outline, world units.
 * @param outline - The join, miter limit, dash and dash cap; default none, drawn as
 *   every earlier build drew it.
 * @param corners - Per point of `polyline`, whether the outline's join applies there (a
 *   path's vertex) or the join is round (inside a flattened curve); default everywhere.
 */
export function writeStroke(
  writer: TriangleWriter,
  polyline: readonly Point[],
  width: number,
  isClosed: boolean,
  capStyle: StrokeCapOption,
  tolerance: number,
  outline: StrokeOutline = PLAIN_OUTLINE,
  corners?: readonly boolean[],
): void {
  const line = distinctPoints({ points: polyline, corners }, isClosed);
  const halfWidth = width / 2;
  const caps = resolveCaps(capStyle);
  const [only] = line.points;
  if (line.points.length === 1 && only) {
    writeLonePoint(writer, only, halfWidth, caps, isClosed, tolerance);
    return;
  }
  if (line.points.length < 2) return;
  const { dash } = outline;
  if (
    dash &&
    writeDashes(writer, line, isClosed, halfWidth, caps, tolerance, { ...outline, dash })
  ) {
    return;
  }
  writeLine(writer, strokeLineOf(line, isClosed), halfWidth, caps, tolerance, outline);
}

/**
 * The triangle mesh of a stroked polyline (the prototype's `strokeMesh`,
 * `webgl-whiteboard/src/vector/stroke.ts`): a quad per segment, joins and the given caps. A join is
 * mitred only where the mitre stays within `tolerance` of the round join (gentle turns, such as
 * between the pieces of a flattened curve); elsewhere the outer side of the turn gets a sector of
 * the half-width, or with an outline's `bevel` or `miter` join a bevel or a miter
 * (bevelled past the miter limit). An outline's dash cuts the stroke into pieces along its length
 * (`dashIntervals`), each capped with the outline's cap. Arcs are divided so their chords stay
 * within `tolerance`. Triangles overlap at joins and where dashes cross, so a translucent stroke is
 * drawn through the stencil (the path pass, `createPathPass`) to cover each pixel once. Pure.
 *
 * @param polyline - The centre line, world units; not mutated. Repeated points are ignored.
 * @param width - The stroke's width, world units, at least 0.
 * @param isClosed - Whether the last point joins back to the first; a closed stroke has no caps.
 * @param capStyle - The caps of an open stroke's ends; a lone point is a dot when either is round.
 * @param tolerance - The largest allowed deviation from the exact outline, world units, above 0.
 * @param outline - The join, miter limit, dash and dash cap; default none (round joins, solid).
 * @returns The triangle list, `x, y` per vertex, three vertices per triangle; empty for no points.
 */
export function strokeMesh(
  polyline: readonly Point[],
  width: number,
  isClosed: boolean,
  capStyle: StrokeCapOption,
  tolerance: number,
  outline: StrokeOutline = PLAIN_OUTLINE,
): Float32Array<ArrayBuffer> {
  const writer = new TriangleWriter();
  writeStroke(writer, polyline, width, isClosed, capStyle, tolerance, outline);
  return writer.toFloat32Array();
}
