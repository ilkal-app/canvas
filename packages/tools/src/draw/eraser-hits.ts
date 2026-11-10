import { worldTransformOf, type SceneSource, type WorldBounds } from '@canvas/engine';
import {
  applyTransform,
  FREEHAND_FLATTEN_TOLERANCE,
  flattenFreehand,
  freehandPointsOf,
  invertTransform,
  type FreehandObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

/** The eraser's radius on screen, CSS px: the same at every zoom. */
export const ERASER_RADIUS_PX = 8;

/** The eraser's path since the last input: the previous and current world points. */
export interface EraserSweep {
  /** Where the eraser was, world units. */
  readonly from: Point;
  /** Where it is now, world units. */
  readonly to: Point;
  /** Its radius, world units (`eraserRadius`). */
  readonly radius: number;
}

/** What the eraser reads strokes through: the document, gated as the select tool's source. */
export interface EraserSource extends SceneSource {
  /**
   * Whether the engine draws an object: one hidden, or under a hidden layer, is not erased.
   * Absent, every object counts as drawn but those hidden themselves.
   *
   * @param id - The object.
   * @returns The verdict.
   */
  isDrawable?(id: ObjectId): boolean;
}

/** Deeper than any board nests: the lock walk stops here, so a parent cycle cannot hang it. */
const MAX_DEPTH = 256;

/** Each stroke's centre line, flattened once per stored object (objects are immutable). */
const centreLines = new WeakMap<FreehandObject, readonly Point[]>();

/**
 * The eraser's radius in world units at a zoom: {@link ERASER_RADIUS_PX} screen px. Pure.
 *
 * @param zoom - The camera zoom, above 0.
 * @returns The radius, world units.
 */
export function eraserRadius(zoom: number): number {
  return ERASER_RADIUS_PX / zoom;
}

/**
 * The world box a sweep can touch: its segment grown by its radius. Pure.
 *
 * @param sweep - The sweep.
 * @returns The box, for a cheap candidate query.
 */
export function sweepBounds(sweep: EraserSweep): WorldBounds {
  const { from, to, radius } = sweep;
  return {
    minX: Math.min(from.x, to.x) - radius,
    minY: Math.min(from.y, to.y) - radius,
    maxX: Math.max(from.x, to.x) + radius,
    maxY: Math.max(from.y, to.y) + radius,
  };
}

/**
 * The distance from a point to a segment. Pure.
 *
 * @param point - The point.
 * @param from - The segment's start.
 * @param to - Its end.
 * @returns The distance.
 */
function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + dx * along), point.y - (from.y + dy * along));
}

/**
 * The cross product of `b − a` and `c − a`: which side of `a → b` the point `c` is on.
 *
 * @param a - The line's start.
 * @param b - Its end.
 * @param c - The point.
 * @returns Positive on one side, negative on the other, 0 on the line.
 */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * The distance between two segments: 0 when they cross, else the least distance from an end of
 * one to the other. Pure.
 *
 * @param a0 - The first segment's start.
 * @param a1 - Its end.
 * @param b0 - The second segment's start.
 * @param b1 - Its end.
 * @returns The distance.
 */
export function segmentDistance(a0: Point, a1: Point, b0: Point, b1: Point): number {
  const d1 = cross(a0, a1, b0);
  const d2 = cross(a0, a1, b1);
  const d3 = cross(b0, b1, a0);
  const d4 = cross(b0, b1, a1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    pointSegmentDistance(a0, b0, b1),
    pointSegmentDistance(a1, b0, b1),
    pointSegmentDistance(b0, a0, a1),
    pointSegmentDistance(b1, a0, a1),
  );
}

/**
 * A stroke's centre line, flattened within the hit tolerance, in its own frame.
 *
 * @param stroke - The stroke.
 * @returns Its polyline; one point for a dot.
 */
function centreLineOf(stroke: FreehandObject): readonly Point[] {
  const known = centreLines.get(stroke);
  if (known) return known;
  const line = freehandPointsOf(flattenFreehand(stroke.points, FREEHAND_FLATTEN_TOLERANCE));
  centreLines.set(stroke, line);
  return line;
}

/**
 * Whether a sweep touches a stroke: the distance from the stroke's centre line to the swept
 * segment, in the stroke's own frame, is at most the radius plus half the stroke's width. Pure.
 *
 * @param stroke - The stroke.
 * @param sweep - The sweep, world units.
 * @param source - The document, for the stroke's ancestors' placement.
 * @returns Whether it is touched.
 */
export function isStrokeTouched(
  stroke: FreehandObject,
  sweep: EraserSweep,
  source: SceneSource,
): boolean {
  const toLocal = invertTransform(worldTransformOf(stroke, source));
  const from = applyTransform(toLocal, sweep.from);
  const to = applyTransform(toLocal, sweep.to);
  const reach = sweep.radius + stroke.stroke.width / 2;
  const line = centreLineOf(stroke);
  return line.some(
    (point, index) => segmentDistance(from, to, line[index - 1] ?? point, point) <= reach,
  );
}

/**
 * Whether an object or one of its ancestors is locked.
 *
 * @param id - The object.
 * @param source - The document.
 * @returns True when the object or an ancestor is locked, or it is gone.
 */
function isLockedIn(id: ObjectId, source: SceneSource): boolean {
  let current = source.get(id);
  if (!current) return true;
  for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
    if (current.locked) return true;
    current = current.parentId === null ? undefined : source.get(current.parentId);
  }
  return false;
}

/**
 * The strokes a sweep erases among candidates (a bounds query's answer): freehand objects only
 * (ink, never other objects), shown and unlocked, themselves and their ancestors, whose centre
 * line comes within reach of the sweep (`isStrokeTouched`). Pure.
 *
 * @param sweep - The sweep, world units.
 * @param candidates - The ids whose boxes meet the sweep's box (`sweepBounds`).
 * @param source - The document, gated as the select tool reads it.
 * @returns The touched strokes' ids, in candidate order.
 */
export function erasedStrokes(
  sweep: EraserSweep,
  candidates: Iterable<ObjectId>,
  source: EraserSource,
): ObjectId[] {
  const touched: ObjectId[] = [];
  for (const id of candidates) {
    const object = source.get(id);
    if (
      object?.type === 'freehand' &&
      isErasable(id, source) &&
      isStrokeTouched(object, sweep, source)
    )
      touched.push(id);
  }
  return touched;
}

/**
 * Whether the eraser may erase an object now: a freehand stroke on the board, shown and
 * unlocked, itself and its ancestors. Pure.
 *
 * @param id - The object.
 * @param source - The document, gated as the select tool reads it.
 * @returns The verdict.
 */
export function isErasable(id: ObjectId, source: EraserSource): boolean {
  const object = source.get(id);
  return (
    object?.type === 'freehand' &&
    object.isHidden !== true &&
    source.isDrawable?.(id) !== false &&
    !isLockedIn(id, source)
  );
}
