import type { Point } from '../fields/point.js';
import type { FrameObject } from '../objects/frame-object.js';
import type { PathObject } from '../objects/path-object.js';
import type { ShapeObject } from '../objects/shape-object.js';

import { pathBounds, type Rect } from './local-bounds.js';

// The box a paint is evaluated in: a gradient rotates, moves and stretches with
// its object, so it is evaluated in the object's own frame, normalised to its unit box. Shared by
// the engine's gradient passes, the PNG projection and the default-colour rule. Pure.

/** An object that holds a paint: a shape's or path's fill, a frame's background. */
export type PaintedObject = ShapeObject | PathObject | FrameObject;

/** A point of a paint box's unit square. */
export interface UnitBoxPoint {
  /** Across the box from its left edge; 0 to 1 inside it. */
  readonly u: number;
  /** Down the box from its top edge; 0 to 1 inside it. */
  readonly v: number;
}

/**
 * The box a paint is evaluated in, in the object's own frame: a shape's or frame's
 * `(0, 0)–(width, height)`, a path's network bounds (`pathBounds`: vertices and handle points).
 *
 * @param object - The painted object.
 * @returns The box, world units.
 */
export function paintBoxOf(object: PaintedObject): Rect {
  if (object.type === 'path') return pathBounds(object);
  return { x: 0, y: 0, width: object.width, height: object.height };
}

/**
 * Maps a point of an object's own frame into its paint box's unit square: `u` across from the
 * left edge, `v` down from the top. An axis of zero extent maps to 0.5.
 *
 * @param box - The paint box (`paintBoxOf`).
 * @param point - The point, in the object's own frame, world units.
 * @returns The unit-box coordinates; outside [0, 1] for a point outside the box.
 */
export function paintUnitPoint(box: Rect, point: Point): UnitBoxPoint {
  return {
    u: box.width === 0 ? 0.5 : (point.x - box.x) / box.width,
    v: box.height === 0 ? 0.5 : (point.y - box.y) / box.height,
  };
}
