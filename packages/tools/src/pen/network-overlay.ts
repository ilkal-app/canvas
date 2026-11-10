import {
  cubicOf,
  flattenCubic,
  type Cubic,
  type PathNetwork,
  type WorldBounds,
  type WorldTransform,
} from '@canvas/engine';
import type { Point, Rgba, Segment } from '@canvas/schema';

import { HANDLE_FILL, SELECTION_COLOR, type OverlayRect } from '../select/overlay-rects.js';

import { handleAt, isZeroHandle, segmentsAt } from './network.js';

// What the pen tool and vector edit draw over a path (the prototype's `drawNetworkOverlay`,
// webgl-whiteboard `src/app/modes/vectorShared.ts`), as the overlay's flat rectangles, at one
// screen size whatever the zoom: every segment as a 1 px line (2 px while the pointer is over it in
// vector edit), so a path with no stroke and no fill still shows while it is edited (vector edit
// keeps the skeleton between rebuilds and culls it and the vertices to the viewport); vertices as
// squares (white with a blue border, solid blue when selected), the handles of the selected
// vertices as 1 px lines ending in a diamond, and the pen's next segment as a 1 px polyline.

/** A vertex square's side, CSS px. */
export const VERTEX_SIZE_PX = 8;

/** A handle tip's side, CSS px (drawn turned 45°, a diamond). */
export const HANDLE_TIP_SIZE_PX = 7;

/** Segment lines, handle lines and the pen's preview segment, CSS px wide. */
export const OVERLAY_LINE_WIDTH_PX = 1;

/** The line of the segment under the pointer in vector edit, CSS px wide. */
export const HOVERED_LINE_WIDTH_PX = 2;

/** How far a segment's or the preview's polyline may stray from its curve, CSS px. */
const CURVE_TOLERANCE_PX = 0.5;

/** The inside of an unselected vertex square: the border is this much inside the side, CSS px. */
const VERTEX_BORDER_PX = 1;

/** A handle the network does not hold yet, drawn from a vertex. */
export interface PendingHandle {
  /** The vertex it starts from, local units. */
  readonly from: Point;
  /** Its offset, local units. */
  readonly handle: Point;
}

/** What a network overlay shows. */
export interface NetworkOverlayInput {
  /** The network, in the path's frame. */
  readonly network: PathNetwork;
  /** The path's frame in the world. */
  readonly frame: WorldTransform;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The selected vertices: drawn solid, with their handles shown. */
  readonly selected: ReadonlySet<string>;
  /** A handle the network does not hold yet (the pen's outgoing handle), from a local point. */
  readonly pendingHandle?: PendingHandle | undefined;
  /** The pen's next segment, local units, drawn as a thin polyline. */
  readonly previewSegment?: Cubic | undefined;
  /** The segment under the pointer (vector edit), drawn thicker. */
  readonly hoveredSegmentId?: string | undefined;
  /**
   * The skeleton, already built (vector edit keeps it, `network-skeleton.ts`): drawn in place of
   * every segment's line, the hovered segment's thicker line over it. Built here when absent.
   */
  readonly skeleton?: readonly OverlayRect[] | undefined;
  /** The viewport, world units: a vertex off it is not drawn. Every vertex when absent. */
  readonly viewport?: WorldBounds | undefined;
}

/**
 * A local point in the world.
 *
 * @param frame - The path's frame.
 * @param point - The point, local units.
 * @returns The point, world units.
 */
export function toWorld(frame: WorldTransform, point: Point): Point {
  return {
    x: frame.x + frame.cos * point.x - frame.sin * point.y,
    y: frame.y + frame.sin * point.x + frame.cos * point.y,
  };
}

/**
 * A square centred on a point, turned by an angle.
 *
 * @param centre - The centre, world units.
 * @param side - The side, world units.
 * @param rotation - The turn, radians.
 * @param color - The colour.
 * @returns The rectangle.
 */
function squareAt(centre: Point, side: number, rotation: number, color: Rgba): OverlayRect {
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
  const half = side / 2;
  // The box turns about its top-left corner: put the corner where the turned centre lands.
  const x = centre.x - (cos * half - sin * half);
  const y = centre.y - (sin * half + cos * half);
  return { box: { x, y, width: side, height: side, rotation }, color };
}

/**
 * A line between two points as a thin turned rectangle, centred on the line.
 *
 * @param from - One end, world units.
 * @param to - The other end, world units.
 * @param width - Its width, world units.
 * @param color - The colour.
 * @returns The rectangle, or `undefined` for two equal points.
 */
function lineRect(from: Point, to: Point, width: number, color: Rgba): OverlayRect | undefined {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return undefined;
  const rotation = Math.atan2(to.y - from.y, to.x - from.x);
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
  const half = width / 2;
  const box = { x: from.x + sin * half, y: from.y - cos * half, width: length, height: width };
  return { box: { ...box, rotation }, color };
}

/**
 * A handle drawn from its vertex: the line and the tip.
 *
 * @param from - The vertex, world units.
 * @param tip - The handle's tip, world units.
 * @param pixel - One CSS px, world units.
 * @returns The rectangles.
 */
function handleRects(from: Point, tip: Point, pixel: number): OverlayRect[] {
  const line = lineRect(from, tip, OVERLAY_LINE_WIDTH_PX * pixel, SELECTION_COLOR);
  const outer = squareAt(tip, HANDLE_TIP_SIZE_PX * pixel, Math.PI / 4, SELECTION_COLOR);
  const inner = squareAt(tip, (HANDLE_TIP_SIZE_PX - 3) * pixel, Math.PI / 4, HANDLE_FILL);
  return [...(line ? [line] : []), outer, inner];
}

/**
 * A polyline in the world as thin rectangles, one per stretch.
 *
 * @param points - Its points, world units.
 * @param pixel - One CSS px, world units.
 * @param widthPx - The line's width, CSS px.
 * @returns The rectangles.
 */
export function polylineRects(
  points: readonly Point[],
  pixel: number,
  widthPx: number,
): OverlayRect[] {
  const rects: OverlayRect[] = [];
  let previous: Point | undefined;
  for (const point of points) {
    const line = previous && lineRect(previous, point, widthPx * pixel, SELECTION_COLOR);
    if (line) rects.push(line);
    previous = point;
  }
  return rects;
}

/**
 * A curve in the path's frame as a polyline of thin rectangles.
 *
 * @param cubic - The curve, local units.
 * @param frame - The path's frame.
 * @param pixel - One CSS px, world units.
 * @param widthPx - The line's width, CSS px.
 * @returns The rectangles.
 */
function curveRects(
  cubic: Cubic,
  frame: WorldTransform,
  pixel: number,
  widthPx: number,
): OverlayRect[] {
  const points = flattenCubic(cubic, CURVE_TOLERANCE_PX * pixel).map((point) =>
    toWorld(frame, point),
  );
  return polylineRects(points, pixel, widthPx);
}

/**
 * Every segment of a network as a thin line, the path's skeleton (the hovered one thicker); or
 * the skeleton given, with the hovered segment's thicker line drawn over it.
 *
 * @param input - The overlay's input.
 * @param pixel - One CSS px, world units.
 * @returns The rectangles.
 */
function skeletonRects(input: NetworkOverlayInput, pixel: number): OverlayRect[] {
  const { network, frame, skeleton, hoveredSegmentId } = input;
  const vertexById = new Map(network.vertices.map((vertex) => [vertex.id, vertex]));
  const lineOf = (segment: Segment, widthPx: number) =>
    vertexById.has(segment.a) && vertexById.has(segment.b)
      ? curveRects(cubicOf({ vertexById }, segment), frame, pixel, widthPx)
      : [];
  if (skeleton !== undefined) {
    const hovered = network.segments.find(({ id }) => id === hoveredSegmentId);
    return [...skeleton, ...(hovered ? lineOf(hovered, HOVERED_LINE_WIDTH_PX) : [])];
  }
  return network.segments.flatMap((segment) =>
    lineOf(
      segment,
      segment.id === hoveredSegmentId ? HOVERED_LINE_WIDTH_PX : OVERLAY_LINE_WIDTH_PX,
    ),
  );
}

/**
 * Whether a vertex square is drawn: it is on the viewport, or no viewport is given.
 *
 * @param centre - The vertex, world units.
 * @param viewport - The viewport, world units.
 * @param pixel - One CSS px, world units.
 * @returns `true` when the square is drawn.
 */
function isOnViewport(centre: Point, viewport: WorldBounds | undefined, pixel: number): boolean {
  if (viewport === undefined) return true;
  const half = VERTEX_SIZE_PX * pixel;
  return (
    centre.x >= viewport.minX - half &&
    centre.x <= viewport.maxX + half &&
    centre.y >= viewport.minY - half &&
    centre.y <= viewport.maxY + half
  );
}

/**
 * The overlay of a path's network (see above): the skeleton, then the preview segment, then
 * handle lines and tips under the vertices. Pure.
 *
 * @param input - The network, frame, zoom, selection and the pen's pending handle and segment.
 * @returns The rectangles, in drawing order.
 */
export function networkOverlayRects(input: NetworkOverlayInput): OverlayRect[] {
  const { network, frame, zoom, selected } = input;
  const pixel = 1 / zoom;
  const rotation = Math.atan2(frame.sin, frame.cos);
  const rects = skeletonRects(input, pixel);
  if (input.previewSegment) {
    rects.push(...curveRects(input.previewSegment, frame, pixel, OVERLAY_LINE_WIDTH_PX));
  }
  for (const vertex of network.vertices) {
    if (!selected.has(vertex.id)) continue;
    for (const { segment, end } of segmentsAt(network, vertex.id)) {
      const handle = handleAt(segment, end);
      if (isZeroHandle(handle)) continue;
      const tip = { x: vertex.x + handle.x, y: vertex.y + handle.y };
      rects.push(...handleRects(toWorld(frame, vertex), toWorld(frame, tip), pixel));
    }
  }
  const pending = input.pendingHandle;
  if (pending && !isZeroHandle(pending.handle)) {
    const tip = { x: pending.from.x + pending.handle.x, y: pending.from.y + pending.handle.y };
    rects.push(...handleRects(toWorld(frame, pending.from), toWorld(frame, tip), pixel));
  }
  for (const vertex of network.vertices) {
    const centre = toWorld(frame, vertex);
    if (!isOnViewport(centre, input.viewport, pixel)) continue;
    rects.push(squareAt(centre, VERTEX_SIZE_PX * pixel, rotation, SELECTION_COLOR));
    if (selected.has(vertex.id)) continue;
    const inner = (VERTEX_SIZE_PX - 2 * VERTEX_BORDER_PX) * pixel;
    rects.push(squareAt(centre, inner, rotation, HANDLE_FILL));
  }
  return rects;
}
