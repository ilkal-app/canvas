import { applyTransform, type BoardObject, type ObjectId, type Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { SceneSource } from '../scene/scene-source.js';
import { worldTransformOf, type WorldTransform } from '../scene/world-transform.js';

import { containsPoint } from './bounds.js';
import {
  clipChainOf,
  clipPolygon,
  clipSegment,
  type ClipChainMemo,
  type ClipRect,
} from './clip-chain.js';
import { clippedFillBoundary, clippedFillMeetsBounds } from './clipped-fill.js';
import { objectGeometry, pickRectOf, type ObjectGeometry } from './object-geometry.js';
import { sortTopmostFirst } from './paint-order.js';
import { convexPolygonMeetsBounds, isInsideEvenOdd, segmentMeetsBounds } from './segment-math.js';
import type { SpatialSearch } from './spatial-search.js';

/**
 * How a marquee selects: `intersect` takes every object it touches, `contain` only the objects
 * it wholly encloses.
 */
export type HitRectMode = 'intersect' | 'contain';

/**
 * Finds the objects a marquee selects, topmost first, through the R-tree. The index proposes
 * every object whose world box meets the marquee; each is then checked against its exact geometry
 * in world space. A box (an image's drawn rectangle, `pickRectOf`), rotated with its object, is a
 * convex quadrilateral: `intersect` tests it against the marquee by separating axes, `contain`
 * needs all four corners inside. A line, path or connector (as placed, `ConnectorPlacements`)
 * is its centre line (curves flattened):
 * `intersect` needs a piece of it to cross the marquee, or, for a filled path, the marquee's
 * centre inside the fill; `contain` needs every point of it inside. Clipping frames
 * cut every object first (`clipChainOf`): the box to its clipped polygon (`clipPolygon`), each
 * centre-line segment to its visible piece (`clipSegment`), the fill to the part the chain keeps
 * (`clippedFillBoundary`, `clippedFillMeetsBounds`), outline or no outline.
 * A marquee selects by what is drawn: `intersect` needs it to touch the visible part, so hidden
 * overflow selects nothing; `contain` needs it to enclose the visible part, all of it, so a
 * child whose overflow is clipped away is contained by a marquee round what shows of it (what
 * the user sees is wholly inside the marquee). An object clipped away entirely is never
 * selected. Groups are never returned;
 * locked objects are, and the select tool drops them. Pure: reads the index and
 * the document, mutates neither.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document the index mirrors.
 * @param rect - The marquee, world units.
 * @param mode - Touching or enclosing.
 * @returns The ids selected, topmost first; empty when none.
 */
export function hitRect(
  index: SpatialSearch,
  source: SceneSource,
  rect: WorldBounds,
  mode: HitRectMode,
): ObjectId[] {
  const memo: ClipChainMemo = new Map();
  const hits = index.searchRect(rect).filter((id) => {
    const object = source.get(id);
    const geometry = object && objectGeometry(object);
    if (!object || !geometry) return false;
    const transform = worldTransformOf(object, source);
    const chain = clipChainOf(object, source, memo);
    return isSelectedBy(object, geometry, transform, chain, rect, mode);
  });
  return sortTopmostFirst(hits, source);
}

/**
 * Whether a marquee selects one object's geometry (a box: its pick rectangle, `pickRectOf`).
 *
 * @param object - The object.
 * @param geometry - The object's geometry, in its own frame.
 * @param transform - The object's world transform.
 * @param chain - The clip chain that cuts it (`clipChainOf`).
 * @param rect - The marquee, world units.
 * @param mode - Touching or enclosing.
 * @returns True when selected.
 */
function isSelectedBy(
  object: BoardObject,
  geometry: ObjectGeometry,
  transform: WorldTransform,
  chain: readonly ClipRect[],
  rect: WorldBounds,
  mode: HitRectMode,
): boolean {
  const toWorld = (point: Point) => applyTransform(transform, point);
  if (geometry.kind === 'box') {
    const { x, y, width, height } = pickRectOf(object, geometry);
    const corners = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ].map(toWorld);
    const visible = clipPolygon(corners, chain);
    if (visible.length === 0) return false;
    return mode === 'contain'
      ? visible.every((corner) => containsPoint(rect, corner))
      : convexPolygonMeetsBounds(visible, rect);
  }
  const polylines = geometry.polylines.map((polyline) => polyline.map(toWorld));
  if (polylines.length === 0) return false;
  if (chain.length > 0)
    return isClippedStrokeSelected(geometry, toWorld, polylines, chain, rect, mode);
  const fillPolygons = geometry.fillPolygons.map((polygon) => polygon.map(toWorld));
  if (mode === 'contain') {
    return polylines.every((polyline) => polyline.every((point) => containsPoint(rect, point)));
  }
  const centre = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  return (
    polylines.some((polyline) => crossesBounds(polyline, rect)) ||
    isInsideEvenOdd(fillPolygons, centre)
  );
}

/**
 * Whether a marquee selects what a clip chain leaves of a line, path or connector: its centre
 * line's visible pieces, and the visible part of its even-odd fill (fill ∩ the chain's region,
 * `clipped-fill.ts`), holes respected. `intersect` needs a visible piece or visible fill in the
 * marquee; `contain` needs something visible, and all of it (pieces and the visible fill's
 * boundary) inside the marquee. A fill whose holes cover all that the clip shows is not visible,
 * so selects nothing.
 *
 * @param geometry - The object's geometry, in its own frame.
 * @param geometry.fillPolygons - Its filled loops, in its own frame.
 * @param toWorld - Its frame to the world.
 * @param polylines - Its centre lines, world units.
 * @param chain - The clip chain, not empty.
 * @param rect - The marquee, world units.
 * @param mode - Touching or enclosing.
 * @returns True when selected.
 */
function isClippedStrokeSelected(
  geometry: { readonly fillPolygons: readonly (readonly Point[])[] },
  toWorld: (point: Point) => Point,
  polylines: readonly (readonly Point[])[],
  chain: readonly ClipRect[],
  rect: WorldBounds,
  mode: HitRectMode,
): boolean {
  const pieces = polylines.flatMap((polyline) =>
    polyline.flatMap((start, index) => {
      const end = polyline[index + 1];
      const piece = end === undefined ? undefined : clipSegment(start, end, chain);
      return piece === undefined ? [] : [piece];
    }),
  );
  const fillPolygons = geometry.fillPolygons.map((polygon) => polygon.map(toWorld));
  if (mode === 'contain') {
    const visible =
      fillPolygons.length === 0 ? pieces : [...pieces, ...clippedFillBoundary(fillPolygons, chain)];
    return (
      visible.length > 0 &&
      visible.every(([start, end]) => containsPoint(rect, start) && containsPoint(rect, end))
    );
  }
  if (pieces.some(([start, end]) => segmentMeetsBounds(start, end, rect))) return true;
  return clippedFillMeetsBounds(fillPolygons, chain, rect);
}

function crossesBounds(polyline: readonly Point[], rect: WorldBounds): boolean {
  let start: Point | undefined;
  for (const end of polyline) {
    if (start && segmentMeetsBounds(start, end, rect)) return true;
    start = end;
  }
  return false;
}
