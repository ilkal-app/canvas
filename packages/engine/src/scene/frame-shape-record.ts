import { type BoardObject, type CornerRadii, type FrameObject, type Rgba } from '@canvas/schema';

import { drawnFrameCornerRadii, hasRoundedCorner } from '../shapes/corner-radii.js';
import {
  SHAPE_CORNER_RADII_ATTRIBUTE,
  SHAPE_INSTANCE_FLOATS,
  SHAPE_INSTANCE_VERTEX_LAYOUT,
  SHAPE_KIND_CODES,
} from '../shapes/shape-instance-layout.js';

import { resolveSceneInstanceLayout, type InstanceLayout } from './instance-layout.js';
import type { WorldTransform } from './world-transform.js';

// The SDF records a frame draws with: its drop shadow, its outline, an image background
// and, when its corners are rounded, its solid or gradient background are rounded boxes of the
// shape shader (`sdf-shape.wgsl`), whose record a frame's passes extend with the four corner
// radii it draws (`SHAPE_CORNER_RADII_ATTRIBUTE`), each capped at half the shorter side. A sharp
// frame writes zeros there, which draws exactly what it drew before.

/** The float of a frame's SDF record where its four corner radii start: after the shape record. */
export const FRAME_CORNER_RADII_FLOAT = SHAPE_INSTANCE_FLOATS;

/** Floats of a frame's SDF record before any variant's tail: the shape record and the radii. */
export const FRAME_SHAPE_FLOATS = SHAPE_INSTANCE_FLOATS + 4;

/**
 * The attributes of a frame's SDF record: the shape record's (`SHAPE_INSTANCE_VERTEX_LAYOUT`),
 * then the corner radii at `@location(15)`; a variant appends its own, then the clip index.
 */
export const FRAME_SHAPE_ATTRIBUTES = Object.freeze([
  ...SHAPE_INSTANCE_VERTEX_LAYOUT.attributes,
  SHAPE_CORNER_RADII_ATTRIBUTE,
]);

/** The record layout of the frame passes drawn with the solid shape shader: shadow and outline. */
export const FRAME_SHAPE_INSTANCE_LAYOUT: InstanceLayout =
  resolveSceneInstanceLayout(FRAME_SHAPE_ATTRIBUTES);

/**
 * The corner radii a frame draws with: its `cornerRadius` read and capped at half its shorter
 * side (`drawnFrameCornerRadii`); all 0 for a sharp frame. Pure.
 *
 * @param frame - The frame.
 * @returns The four radii, top-left clockwise.
 */
export function frameRadiiOf(frame: FrameObject): CornerRadii {
  return drawnFrameCornerRadii(frame.cornerRadius, frame.width, frame.height);
}

/**
 * Whether an object is a frame with a rounded corner as drawn. Pure.
 *
 * @param object - The object.
 * @returns True for a rounded frame.
 */
export function isRoundedFrame(object: BoardObject): boolean {
  return (
    object.type === 'frame' &&
    object.cornerRadius !== undefined &&
    hasRoundedCorner(frameRadiiOf(object))
  );
}

/**
 * Writes four corner radii into a frame's SDF record ({@link FRAME_CORNER_RADII_FLOAT}), each
 * rounded corner grown by `grow` (a shadow's spread, an outline's reach) and a sharp one kept
 * sharp, as a single radius grows. A sharp frame leaves zeros. Field by field.
 *
 * @param record - The record.
 * @param radii - The radii as drawn.
 * @param grow - How far the box they round is grown on every side, world units. Default 0.
 */
export function writeFrameCornerRadii(record: Float32Array, radii: CornerRadii, grow = 0): void {
  radii.forEach((radius, corner) => {
    record[FRAME_CORNER_RADII_FLOAT + corner] = radius > 0 ? Math.max(0, radius + grow) : 0;
  });
}

/**
 * Writes a frame background's SDF record: its box, placed and turned by its world transform, as
 * a rounded box with its corner radii (sharp ones zero), filled with `color`, with no outline.
 * Field by field.
 *
 * @param record - The record, zero-filled.
 * @param frame - The frame.
 * @param transform - Its frame to the world.
 * @param color - The straight-alpha fill; clear for a background another source colours.
 */
export function writeFrameBackgroundRecord(
  record: Float32Array,
  frame: FrameObject,
  transform: WorldTransform,
  color: Rgba,
): void {
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = frame.width;
  record[3] = frame.height;
  record[4] = color[0];
  record[5] = color[1];
  record[6] = color[2];
  record[7] = color[3];
  record[10] = SHAPE_KIND_CODES['rounded-box'];
  record[11] = transform.cos;
  record[12] = transform.sin;
  writeFrameCornerRadii(record, frameRadiiOf(frame));
}
