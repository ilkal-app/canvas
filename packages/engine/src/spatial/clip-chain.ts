import type { BoardObject, FrameCornerRadius, ObjectId, Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { SceneSource } from '../scene/scene-source.js';
import { worldTransformOf, type WorldTransform } from '../scene/world-transform.js';
import { drawnFrameCornerRadii, hasRoundedCorner } from '../shapes/corner-radii.js';

/**
 * How many clipping ancestors clip an object, innermost first: the shaders walk at
 * most this many levels of the clip table, and the CPU mirror keeps the same innermost ones, so
 * what is drawn, culled and hit agree. A ninth and further outer clipping frame is ignored.
 */
export const MAX_CLIP_DEPTH = 8;

/**
 * A clipping frame's box on the board: `[0, width] × [0, height]` in the frame's own frame,
 * which `x`, `y`, `cos` and `sin` place in the world (its `WorldTransform`).
 */
export interface ClipRect {
  /** The clipping frame. */
  readonly id: ObjectId;
  /** World x of the frame's local origin (its top-left corner), world units. */
  readonly x: number;
  /** World y of the frame's local origin, world units. */
  readonly y: number;
  /** Cosine of the frame's world rotation. */
  readonly cos: number;
  /** Sine of the frame's world rotation. */
  readonly sin: number;
  /** The frame's width, world units. */
  readonly width: number;
  /** The frame's height, world units. */
  readonly height: number;
  /**
   * The frame's stored corner rounding, one radius or four from the top-left
   * clockwise; absent for sharp corners. Drawn and tested capped at half the shorter side
   * (`drawnFrameCornerRadii`).
   */
  readonly cornerRadius?: FrameCornerRadius;
}

/** A box `[0, width] × [0, height]` in a frame that `transform` places in the world. */
export interface OrientedBox {
  /** The box's frame to the world. */
  readonly transform: WorldTransform;
  /** Its width, world units. */
  readonly width: number;
  /** Its height, world units. */
  readonly height: number;
}

/**
 * Clip chains already worked out within one document state, keyed by the container (frame or
 * group) whose children they clip: that container's own box first when it clips, then its
 * ancestors'. Owned by the caller; drop it when the document changes.
 */
export type ClipChainMemo = Map<ObjectId, readonly ClipRect[]>;

const EMPTY_CHAIN: readonly ClipRect[] = Object.freeze([]);

/**
 * The box of a frame that clips its descendants, with its corner rounding, or
 * undefined for any other object.
 *
 * @param object - The object.
 * @param source - The document, for the object's ancestors.
 * @returns The frame's clip rectangle in the world, or undefined.
 */
export function clipRectOf(object: BoardObject, source: SceneSource): ClipRect | undefined {
  if (object.type !== 'frame' || !object.clip) return undefined;
  const { x, y, cos, sin } = worldTransformOf(object, source);
  const rect = { id: object.id, x, y, cos, sin, width: object.width, height: object.height };
  return object.cornerRadius === undefined ? rect : { ...rect, cornerRadius: object.cornerRadius };
}

/**
 * The clip chain an object's content is clipped by: the boxes of its clipping
 * ancestors, innermost first, at most {@link MAX_CLIP_DEPTH} of them (the innermost). A frame is
 * never clipped by its own box, only by its ancestors'; groups and frames that do not clip pass
 * their ancestors' clips through. A missing parent or a parent cycle ends the walk, as in
 * `worldTransformOf`. Pure apart from filling `memo`; O(depth) without a memo, and O(1) for the
 * siblings of an object already walked with one.
 *
 * @param object - The object; not mutated.
 * @param source - The document, for its ancestors.
 * @param memo - Chains of containers walked in the same document state, filled in as it goes.
 * @returns The chain, innermost first; empty when nothing clips the object.
 */
export function clipChainOf(
  object: BoardObject,
  source: SceneSource,
  memo?: ClipChainMemo,
): readonly ClipRect[] {
  if (object.parentId === null) return EMPTY_CHAIN;
  // Ancestors from the parent up to the first one already known (or the root).
  const pending: BoardObject[] = [];
  const visited = new Set<ObjectId>([object.id]);
  let known: readonly ClipRect[] = EMPTY_CHAIN;
  let parent = source.get(object.parentId);
  while (parent !== undefined && !visited.has(parent.id)) {
    const memoised = memo?.get(parent.id);
    if (memoised !== undefined) {
      known = memoised;
      break;
    }
    visited.add(parent.id);
    pending.push(parent);
    parent = parent.parentId === null ? undefined : source.get(parent.parentId);
  }
  for (let index = pending.length - 1; index >= 0; index--) {
    const ancestor = pending[index];
    if (ancestor === undefined) continue;
    const rect = clipRectOf(ancestor, source);
    if (rect !== undefined) known = [rect, ...known.slice(0, MAX_CLIP_DEPTH - 1)];
    memo?.set(ancestor.id, known);
  }
  return known;
}

/**
 * A world point in a clip rectangle's own frame.
 *
 * @param point - The world point.
 * @param rect - The rectangle.
 * @returns The point in the rectangle's frame, world units.
 */
function localOf(point: Point, rect: ClipRect): Point {
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  return { x: rect.cos * dx + rect.sin * dy, y: rect.cos * dy - rect.sin * dx };
}

/**
 * How far a world point lies outside a clip rectangle's box: the box distance
 * `max(−x, x − width, −y, y − height)` in the rectangle's frame, negative inside; for a box with
 * rounded corners, the exact rounded-box distance, each corner by its own capped
 * radius, as the shader's `clipRoundedDistance`.
 *
 * @param point - The world point.
 * @param rect - The rectangle.
 * @returns The distance, world units.
 */
function boxDistance(point: Point, rect: ClipRect): number {
  const local = localOf(point, rect);
  const radii =
    rect.cornerRadius === undefined
      ? undefined
      : drawnFrameCornerRadii(rect.cornerRadius, rect.width, rect.height);
  if (radii === undefined || !hasRoundedCorner(radii)) {
    return Math.max(-local.x, local.x - rect.width, -local.y, local.y - rect.height);
  }
  const halfX = rect.width / 2;
  const halfY = rect.height / 2;
  const qx = local.x - halfX;
  const qy = local.y - halfY;
  const radius = qx < 0 ? (qy < 0 ? radii[0] : radii[3]) : qy < 0 ? radii[1] : radii[2];
  const dx = Math.abs(qx) - halfX + radius;
  const dy = Math.abs(qy) - halfY + radius;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
}

/**
 * Whether a world point is inside every box of a clip chain, edges included.
 *
 * @param point - The world point.
 * @param point.x - Its x, world units.
 * @param point.y - Its y, world units.
 * @param chain - The chain (`clipChainOf`).
 * @returns True when nothing in the chain clips the point away.
 */
export function isInsideClipChain(
  point: { readonly x: number; readonly y: number },
  chain: readonly ClipRect[],
): boolean {
  return chain.every((rect) => boxDistance(point, rect) <= 0);
}

/**
 * The coverage the shaders multiply a fragment by at a world point (`clip-shader.ts`): with `d`
 * the largest box distance over the chain, `clamp(0.5 − d / pixel, 0, 1)`, so a clip edge is
 * antialiased over one device pixel like an SDF shape's. The CPU mirror of the GPU's coverage.
 *
 * @param point - The world point.
 * @param point.x - Its x, world units.
 * @param point.y - Its y, world units.
 * @param chain - The chain (`clipChainOf`).
 * @param pixel - One device pixel in world units (`1 / (zoom × dpr)`), above 0.
 * @returns The coverage in [0, 1]; 1 for an empty chain.
 */
export function clipCoverageAt(
  point: { readonly x: number; readonly y: number },
  chain: readonly ClipRect[],
  pixel: number,
): number {
  if (chain.length === 0) return 1;
  let distance = Number.NEGATIVE_INFINITY;
  for (const rect of chain) distance = Math.max(distance, boxDistance(point, rect));
  return Math.min(1, Math.max(0, 0.5 - distance / pixel));
}

/**
 * Cuts a convex polygon by one half-plane, Sutherland–Hodgman style: the points where
 * `side(point) ≥ 0` are kept, and each crossing edge adds its crossing point.
 *
 * @param polygon - The polygon's vertices, in order; not mutated.
 * @param side - The signed distance to the half-plane's edge, non-negative inside.
 * @returns The cut polygon; empty when nothing is inside.
 */
function cutPolygon(polygon: readonly Point[], side: (point: Point) => number): Point[] {
  const cut: Point[] = [];
  polygon.forEach((current, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? current;
    const here = side(current);
    const there = side(next);
    if (here >= 0) cut.push(current);
    if (here >= 0 !== there >= 0) {
      const t = here / (here - there);
      cut.push({
        x: current.x + (next.x - current.x) * t,
        y: current.y + (next.y - current.y) * t,
      });
    }
  });
  return cut;
}

/**
 * The four corners of a shape in the world, in order round it.
 *
 * @param shape - Axis-aligned bounds or an oriented box.
 * @returns The corners.
 */
function cornersOf(shape: WorldBounds | OrientedBox): Point[] {
  if (!('transform' in shape)) {
    const { minX, minY, maxX, maxY } = shape;
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }
  const { transform, width, height } = shape;
  const at = (x: number, y: number): Point => ({
    x: transform.x + transform.cos * x - transform.sin * y,
    y: transform.y + transform.sin * x + transform.cos * y,
  });
  return [at(0, 0), at(width, 0), at(width, height), at(0, height)];
}

/**
 * What a clip chain leaves of a convex polygon: the polygon cut by the four edges of
 * every box in the chain (Sutherland–Hodgman), so a rotated clip cuts exactly. The result is
 * convex too. A box's rounded corners are cut as its square ones, so what is left errs
 * large by at most the corners, as culling and the marquee allow. Pure.
 *
 * @param polygon - The polygon's vertices in world units, in order round it; not mutated.
 * @param chain - The chain (`clipChainOf`).
 * @returns The cut polygon's vertices; the polygon itself for an empty chain, empty when
 *   nothing is left.
 */
export function clipPolygon(polygon: readonly Point[], chain: readonly ClipRect[]): Point[] {
  let cut = [...polygon];
  for (const rect of chain) {
    const { width, height } = rect;
    cut = cutPolygon(cut, (point) => localOf(point, rect).x);
    cut = cutPolygon(cut, (point) => width - localOf(point, rect).x);
    cut = cutPolygon(cut, (point) => localOf(point, rect).y);
    cut = cutPolygon(cut, (point) => height - localOf(point, rect).y);
    if (cut.length === 0) return cut;
  }
  return cut;
}

/**
 * What a clip chain leaves of a segment: the piece inside every box of the chain,
 * Liang–Barsky in each box's own frame, so a rotated clip cuts exactly. Rounded corners
 * are cut as square ones, erring large. Pure.
 *
 * @param start - The segment's start, world units.
 * @param end - Its end, world units.
 * @param chain - The chain (`clipChainOf`).
 * @returns The piece's ends, in the segment's direction; undefined when nothing is left.
 */
export function clipSegment(
  start: Point,
  end: Point,
  chain: readonly ClipRect[],
): readonly [Point, Point] | undefined {
  let from = 0;
  let to = 1;
  for (const rect of chain) {
    const a = localOf(start, rect);
    const b = localOf(end, rect);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Each edge of the box is a constraint `p × t ≤ q` on the segment's parameter t.
    const constraints: readonly (readonly [number, number])[] = [
      [-dx, a.x],
      [dx, rect.width - a.x],
      [-dy, a.y],
      [dy, rect.height - a.y],
    ];
    for (const [p, q] of constraints) {
      if (p === 0) {
        if (q < 0) return undefined;
        continue;
      }
      if (p < 0) from = Math.max(from, q / p);
      else to = Math.min(to, q / p);
      if (from > to) return undefined;
    }
  }
  const at = (t: number): Point => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  });
  return [from === 0 ? start : at(from), to === 1 ? end : at(to)];
}

/**
 * The bounds of what a clip chain leaves of a shape: the shape's polygon cut by the
 * four edges of every box in the chain (`clipPolygon`), so a rotated clip or shape is cut
 * exactly, not by its bounding box. Pure.
 *
 * @param shape - Axis-aligned world bounds, or an oriented box; not mutated.
 * @param chain - The chain (`clipChainOf`).
 * @returns The axis-aligned world bounds of what is left, or undefined when nothing is.
 */
export function clipBounds(
  shape: WorldBounds | OrientedBox,
  chain: readonly ClipRect[],
): WorldBounds | undefined {
  const polygon = clipPolygon(cornersOf(shape), chain);
  if (polygon.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
