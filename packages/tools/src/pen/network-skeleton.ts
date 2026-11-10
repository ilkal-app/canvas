import {
  flattenCubic,
  type PathNetwork,
  type WorldBounds,
  type WorldTransform,
} from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { OverlayRect } from '../select/overlay-rects.js';

import { OVERLAY_LINE_WIDTH_PX, polylineRects, toWorld } from './network-overlay.js';
import { segmentBoundsOf } from './segment-bounds.js';

// Vector edit draws every segment of the edited path as a thin line, its skeleton. On a
// 1,000-segment path that is about 5,000 rectangles, and the overlay is rebuilt on every change
// signal (a hover that highlights another segment, a zoom), so rebuilding it whole took 2.5 to
// 3.4 ms (fix round 2). The skeleton is kept instead:
// - each segment's polyline in the world, per network object (an edit or a preview is a new one),
//   frame and zoom bucket (half an octave, flattened for the bucket's finest zoom, so a curve
//   never strays more than half a pixel from its line);
// - the rectangles, per polyline set, exact zoom (a line stays one pixel wide) and region: the
//   segments whose polyline box meets the viewport grown by half its size on every side, so a pan
//   within that margin reuses them; the whole skeleton when the viewport is not known.

/** How far a segment's polyline may stray from its curve, CSS px. */
const CURVE_TOLERANCE_PX = 0.5;

/** Zoom buckets per doubling of the zoom. */
const BUCKETS_PER_OCTAVE = 2;

/** How much of the viewport's size the culled region adds on each side. */
const REGION_MARGIN = 0.5;

/** One segment's polyline, world units, and the box round it. */
interface SegmentLine {
  /** The polyline's points. */
  readonly points: readonly Point[];
  /** The box round them. */
  readonly bounds: WorldBounds;
}

/** What the polylines were made for. */
interface LinesKey {
  readonly network: PathNetwork;
  readonly frame: WorldTransform;
  readonly bucket: number;
}

/**
 * The box round points.
 *
 * @param points - The points; at least one.
 * @returns The box.
 */
function boundsOfPoints(points: readonly Point[]): WorldBounds {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Whether two boxes meet.
 *
 * @param first - One box.
 * @param second - The other.
 * @returns `true` when they overlap or touch.
 */
function isMeeting(first: WorldBounds, second: WorldBounds): boolean {
  return (
    first.minX <= second.maxX &&
    second.minX <= first.maxX &&
    first.minY <= second.maxY &&
    second.minY <= first.maxY
  );
}

/**
 * Whether a box holds another.
 *
 * @param outer - The box that may hold.
 * @param inner - The box that may be held.
 * @returns `true` when `inner` is inside `outer`.
 */
export function isInside(outer: WorldBounds, inner: WorldBounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

/**
 * The region a viewport's skeleton is culled to: the viewport grown by half its size each side.
 *
 * @param viewport - The viewport, world units.
 * @returns The region.
 */
function regionOf(viewport: WorldBounds): WorldBounds {
  const marginX = (viewport.maxX - viewport.minX) * REGION_MARGIN;
  const marginY = (viewport.maxY - viewport.minY) * REGION_MARGIN;
  return {
    minX: viewport.minX - marginX,
    minY: viewport.minY - marginY,
    maxX: viewport.maxX + marginX,
    maxY: viewport.maxY + marginY,
  };
}

/**
 * Whether two frames are the same.
 *
 * @param first - One frame.
 * @param second - The other.
 * @returns `true` when every field is equal.
 */
function isSameFrame(first: WorldTransform, second: WorldTransform): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.cos === second.cos &&
    first.sin === second.sin
  );
}

/**
 * The skeleton of the path vector edit shows (see above): the rectangles of every segment's
 * 1 px line, kept between rebuilds and culled to the viewport. Main thread; no DOM.
 */
export class NetworkSkeleton {
  private linesKey: LinesKey | undefined;
  private lines: readonly SegmentLine[] = [];
  private rectsKey: { lines: readonly SegmentLine[]; zoom: number; region?: WorldBounds } = {
    lines: [],
    zoom: Number.NaN,
  };
  private rectsValue: readonly OverlayRect[] = [];

  /**
   * The region the skeleton last drawn was culled to: what the rest of the overlay culls to as
   * well, so a pan inside it that rebuilds nothing leaves nothing out.
   *
   * @returns The region, world units, or `undefined` when it was not culled.
   */
  get region(): WorldBounds | undefined {
    return this.rectsKey.region;
  }

  /**
   * Whether the skeleton last drawn covers a viewport, so a camera move to it needs no rebuild.
   *
   * @param viewport - The viewport, world units.
   * @returns `true` when the last region holds it, or the last skeleton was not culled.
   */
  covers(viewport: WorldBounds): boolean {
    const { region } = this.rectsKey;
    return region === undefined || isInside(region, viewport);
  }

  /**
   * The skeleton's rectangles.
   *
   * @param network - The network, in the path's frame.
   * @param frame - The path's frame in the world.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param viewport - The viewport, world units; the whole skeleton when absent.
   * @returns The rectangles, in segment order; the same array while nothing changed.
   */
  rects(
    network: PathNetwork,
    frame: WorldTransform,
    zoom: number,
    viewport?: WorldBounds,
  ): readonly OverlayRect[] {
    const lines = this.linesOf(network, frame, zoom);
    const key = this.rectsKey;
    const isCovered =
      viewport === undefined
        ? key.region === undefined
        : key.region !== undefined && isInside(key.region, viewport);
    if (key.lines === lines && key.zoom === zoom && isCovered) return this.rectsValue;
    const region = viewport === undefined ? undefined : regionOf(viewport);
    const pixel = 1 / zoom;
    this.rectsValue = lines
      .filter(({ bounds }) => region === undefined || isMeeting(bounds, region))
      .flatMap(({ points }) => polylineRects(points, pixel, OVERLAY_LINE_WIDTH_PX));
    this.rectsKey = { lines, zoom, ...(region && { region }) };
    return this.rectsValue;
  }

  /**
   * Every segment's polyline in the world, kept per network, frame and zoom bucket.
   *
   * @param network - The network.
   * @param frame - The path's frame.
   * @param zoom - The camera zoom.
   * @returns The polylines.
   */
  private linesOf(
    network: PathNetwork,
    frame: WorldTransform,
    zoom: number,
  ): readonly SegmentLine[] {
    const bucket = Math.floor(Math.log2(zoom) * BUCKETS_PER_OCTAVE);
    const key = this.linesKey;
    if (key?.network === network && key.bucket === bucket && isSameFrame(key.frame, frame)) {
      return this.lines;
    }
    // Flattened for the bucket's finest zoom.
    const tolerance = CURVE_TOLERANCE_PX / 2 ** ((bucket + 1) / BUCKETS_PER_OCTAVE);
    this.lines = segmentBoundsOf(network).map(({ cubic }) => {
      const points = flattenCubic(cubic, tolerance).map((point) => toWorld(frame, point));
      return { points, bounds: boundsOfPoints(points) };
    });
    this.linesKey = { network, frame, bucket };
    return this.lines;
  }
}
