import {
  applyTransform,
  invertTransform,
  strokeOutsetOf,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { ColorPalette } from '../paint/color-palette.js';
import { flattenToleranceOf, pickFlattenBucket } from '../paths/flatten-bucket.js';
import { isRoundedFrame } from '../scene/frame-shape-record.js';
import type { SceneSource } from '../scene/scene-source.js';
import { worldTransformOf } from '../scene/world-transform.js';

import { expandBounds, pointBounds } from './bounds.js';
import { clipChainOf, isInsideClipChain, type ClipChainMemo } from './clip-chain.js';
import { isInsideFrameShape } from './frame-hit.js';
import { objectGeometry, pickRectOf, type ObjectGeometry } from './object-geometry.js';
import { sortTopmostFirst } from './paint-order.js';
import { distanceToPolylines, isInsideEvenOdd } from './segment-math.js';
import { isPointOnShape } from './shape-hit.js';
import type { SpatialSearch } from './spatial-search.js';

/** The default pick tolerance around strokes: 4 CSS pixels, whatever the zoom. */
export const DEFAULT_HIT_TOLERANCE_PX = 4;

/**
 * The default pick tolerance around a connector's line, CSS pixels (item 5): wider than
 * {@link DEFAULT_HIT_TOLERANCE_PX}, as a connector is a thin line people grab to select it.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** How {@link hitPoint} turns a screen tolerance into world units. */
export interface HitPointOptions {
  /** The camera's zoom, CSS pixels per world unit; greater than 0. */
  readonly zoom: number;
  /**
   * How far from a stroke a pick still hits it, CSS pixels, at least 0. Default
   * {@link DEFAULT_HIT_TOLERANCE_PX}, and `CONNECTOR_HIT_TOLERANCE_PX` (6) for a connector.
   */
  readonly tolerancePx?: number;
  /** The device pixel ratio the scene is drawn at, as the camera's `dpr`. Default 1. */
  readonly dpr?: number;
  /**
   * The flattening bucket the last pick used (`pickFlattenBucket`'s hysteresis state), so a
   * pick's curves change bucket when the drawing's do. Omitted, the bucket is the zoom's own.
   */
  readonly flattenBucket?: number;
  /**
   * The palette an object's colour tokens resolve in (`hitPaletteOf`), so a shape's token fill
   * transparent in its mode is no fill; the light theme's built-ins when absent.
   */
  readonly paletteOf?: (object: BoardObject) => ColorPalette;
}

/**
 * Finds the objects under a world point, topmost first, for clicking, shift-clicking and
 * hovering. The index proposes every object whose world box is within the tolerance of the point;
 * each is then checked against its exact geometry in its own frame: a box (rotated with its object;
 * an image's drawn rectangle, `pickRectOf`; a frame's grown by its outline's part outside its edge,
 * Its rounded corners left out as drawn) contains the point; a shape's kind
 * contains it when filled, or its outline passes within the tolerance, or its label's box
 * contains it, when not (`isPointOnShape`: an ellipse's box corner is not the ellipse, and a click
 * inside an unfilled shape reaches what shows through it); a line, path or connector (the route
 * and heads of the placed value the source hands, `ConnectorPlacements`) passes within half its
 * stroke width plus the tolerance (a connector's `CONNECTOR_HIT_TOLERANCE_PX` (6) unless one is
 * given; a connector's label box grown by it hits too, item 5), or, for a filled path,
 * has the point inside its even-odd fill (its closed loops, as the path pass fills them). The marquee (`hitRect`) still uses boxes. Curves are
 * flattened with the path pass's tolerance for the bucket of zoom × dpr (`options.dpr`, and the
 * hysteresis state `options.flattenBucket`). A candidate whose clipping ancestors cut the point
 * away (`clipChainOf`, `isInsideClipChain`) is not hit, whatever its geometry: a click on
 * a child's clipped-away overflow reaches what is drawn there. The tolerance is `tolerancePx / zoom` world units,
 * so a pick feels the same at every zoom. Groups are never returned (they have no geometry of
 * their own); the select tool maps a hit child to the group the user means. Locked objects are
 * returned; the tool decides whether they can be picked. Pure: reads the index and the
 * document, mutates neither.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document the index mirrors, to read objects and their ancestors.
 * @param point - The pick point, world units (`screenToWorld` of the pointer).
 * @param options - The zoom and the pick tolerance.
 * @returns The ids hit, topmost first (`sortTopmostFirst`); empty when none.
 * @throws {RangeError} When the zoom is not greater than 0 or the tolerance is negative.
 */
export function hitPoint(
  index: SpatialSearch,
  source: SceneSource,
  point: Point,
  options: HitPointOptions,
): ObjectId[] {
  const { candidates, isHit } = pickAt(index, source, point, options);
  return sortTopmostFirst(candidates.filter(isHit), source);
}

/**
 * The topmost object under a world point that a filter accepts: what `hitPoint(...)` would list
 * first among the accepted, found top down. The filter runs on every candidate the
 * index proposes, before any exact test, so it must be cheap (a type, a flag, the context); the
 * accepted candidates are ordered topmost first (`sortTopmostFirst`) and tested against their
 * exact geometry in that order, stopping at the first hit, so a hover or a drop over a dense
 * stack tests one object rather than all of them. Pure, as `hitPoint`.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document the index mirrors.
 * @param point - The pick point, world units.
 * @param options - The zoom and the pick tolerance, as `hitPoint`'s.
 * @param accept - Which objects may be picked; all when omitted.
 * @returns The topmost accepted object hit, or undefined.
 * @throws {RangeError} When the zoom is not greater than 0 or the tolerance is negative.
 */
export function hitTopmost(
  index: SpatialSearch,
  source: SceneSource,
  point: Point,
  options: HitPointOptions,
  accept?: (object: BoardObject) => boolean,
): ObjectId | undefined {
  const { candidates, isHit } = pickAt(index, source, point, options);
  const accepted =
    accept === undefined
      ? candidates
      : candidates.filter((id) => {
          const object = source.get(id);
          return object !== undefined && accept(object);
        });
  return sortTopmostFirst(accepted, source).find(isHit);
}

/**
 * The index's candidates under a point and the exact test `hitPoint` applies to each.
 *
 * @param index - The spatial index.
 * @param source - The document.
 * @param point - The pick point, world units.
 * @param options - The zoom and the pick tolerance.
 * @returns The candidates and the test.
 * @throws {RangeError} When the zoom is not greater than 0 or the tolerance is negative.
 */
function pickAt(
  index: SpatialSearch,
  source: SceneSource,
  point: Point,
  options: HitPointOptions,
): { readonly candidates: readonly ObjectId[]; readonly isHit: (id: ObjectId) => boolean } {
  const tolerancePx = options.tolerancePx ?? DEFAULT_HIT_TOLERANCE_PX;
  if (!(options.zoom > 0) || !(tolerancePx >= 0)) {
    throw new RangeError(
      `hitPoint needs zoom > 0 and tolerancePx ≥ 0; got ${String(options.zoom)} and ${String(tolerancePx)}.`,
    );
  }
  const tolerance = tolerancePx / options.zoom;
  const connectorTolerance = (options.tolerancePx ?? CONNECTOR_HIT_TOLERANCE_PX) / options.zoom;
  // Curves flattened as the path pass draws them at this zoom: device pixels, with the same
  // hysteresis, so a pick agrees with the pixels.
  const bucket = pickFlattenBucket(options.zoom * (options.dpr ?? 1), options.flattenBucket);
  const flattenTolerance = flattenToleranceOf(bucket);
  const memo: ClipChainMemo = new Map();
  const isHit = (id: ObjectId): boolean => {
    const object = source.get(id);
    if (!object || !isInsideClipChain(point, clipChainOf(object, source, memo))) return false;
    const geometry = objectGeometry(object, flattenTolerance);
    if (!geometry) return false;
    const local = applyTransform(invertTransform(worldTransformOf(object, source)), point);
    if (object.type === 'shape') {
      return isPointOnShape(object, local, tolerance, options.paletteOf?.(object));
    }
    if (object.type === 'connector')
      return isPointOnGeometry(object, geometry, local, connectorTolerance);
    return isPointOnGeometry(object, geometry, local, tolerance);
  };
  const reach = Math.max(tolerance, connectorTolerance);
  return { candidates: index.searchRect(expandBounds(pointBounds(point), reach)), isHit };
}

/**
 * Whether a point in an object's own frame hits its geometry (a box: its pick rectangle,
 * `pickRectOf`, a frame's grown by its outline's part outside its edge, as a shape's
 * outline counts as part of it, and a rounded frame's corners rounded as drawn).
 *
 * @param object - The object.
 * @param geometry - The object's geometry.
 * @param point - The point, in the object's frame.
 * @param tolerance - The pick tolerance around strokes, world units.
 * @returns True for a hit.
 */
function isPointOnGeometry(
  object: BoardObject,
  geometry: ObjectGeometry,
  point: Point,
  tolerance: number,
): boolean {
  if (geometry.kind === 'box') {
    const { x, y, width, height } = pickRectOf(object, geometry);
    const outset = object.type === 'frame' ? strokeOutsetOf(object.stroke, object.strokeAlign) : 0;
    if (object.type === 'frame' && isRoundedFrame(object)) {
      return isInsideFrameShape(object, point, outset);
    }
    return (
      point.x >= x - outset &&
      point.y >= y - outset &&
      point.x <= x + width + outset &&
      point.y <= y + height + outset
    );
  }
  const box = geometry.labelBox;
  if (
    box !== undefined &&
    point.x >= box.x - tolerance &&
    point.y >= box.y - tolerance &&
    point.x <= box.x + box.width + tolerance &&
    point.y <= box.y + box.height + tolerance
  ) {
    return true;
  }
  if (isInsideEvenOdd(geometry.fillPolygons, point)) return true;
  return distanceToPolylines(point, geometry.polylines) <= tolerance + geometry.strokeWidth / 2;
}
