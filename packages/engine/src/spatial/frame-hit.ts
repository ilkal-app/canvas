import type { CornerRadii, FrameObject, Point } from '@canvas/schema';

import { frameRadiiOf, isRoundedFrame } from '../scene/frame-shape-record.js';
import { roundedBoxDistance } from '../shapes/shape-distance.js';

/**
 * The radius of the corner whose quadrant a point lies in, from the box's centre (y down), as
 * the shader's `cornerRadiusAt` picks it. Pure.
 *
 * @param point - The point, relative to the box's centre.
 * @param radii - Top-left, top-right, bottom-right, bottom-left.
 * @returns The radius.
 */
export function cornerRadiusAt(point: Point, radii: CornerRadii): number {
  if (point.x < 0) return point.y < 0 ? radii[0] : radii[3];
  return point.y < 0 ? radii[1] : radii[2];
}

/**
 * The signed distance from a point in a frame's own frame to where its rounded box ends when
 * grown by `outward` on every side (its outline's part outside its edge), as the
 * shape shader draws it: each rounded corner's radius grown by `outward`, a sharp one
 * kept sharp. Negative inside. Pure.
 *
 * @param point - The point, in the frame's frame (its box's top-left at the origin).
 * @param size - The frame's box.
 * @param size.width - Its width.
 * @param size.height - Its height.
 * @param radii - Its corner radii as drawn (capped).
 * @param outward - How far its outline reaches past the edge, at least 0.
 * @returns The distance, world units.
 */
export function roundedFrameDistance(
  point: Point,
  size: { readonly width: number; readonly height: number },
  radii: CornerRadii,
  outward: number,
): number {
  const half = { x: size.width / 2, y: size.height / 2 };
  const local = { x: point.x - half.x, y: point.y - half.y };
  const radius = cornerRadiusAt(local, radii);
  const grown = { x: half.x + outward, y: half.y + outward };
  return roundedBoxDistance(local, grown, radius > 0 ? radius + outward : 0);
}

/**
 * Whether a point in a frame's own frame lies in its box grown by `outward` (its outline's part
 * outside its edge), with a rounded frame's empty corners left out as drawn: what a
 * pick of the frame, or of its background's colour, hits. Edges included. Pure.
 *
 * @param frame - The frame.
 * @param point - The point, in the frame's frame (its box's top-left at the origin).
 * @param outward - How far the box is grown on every side, at least 0. Default 0.
 * @returns True inside.
 */
export function isInsideFrameShape(frame: FrameObject, point: Point, outward = 0): boolean {
  if (isRoundedFrame(frame)) {
    return roundedFrameDistance(point, frame, frameRadiiOf(frame), outward) <= 0;
  }
  return (
    point.x >= -outward &&
    point.y >= -outward &&
    point.x <= frame.width + outward &&
    point.y <= frame.height + outward
  );
}
