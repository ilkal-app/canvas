import type { Point } from '../fields/point.js';

/**
 * A rotation followed by a translation, mapping a point `p` to
 * `(cos·p.x − sin·p.y + x, sin·p.x + cos·p.y + y)`. Every transform in the document model is
 * rigid: objects have a position and a rotation and no scale.
 */
export interface RigidTransform {
  /** Cosine of the rotation angle. */
  readonly cos: number;
  /** Sine of the rotation angle; positive turns clockwise on a y-down screen. */
  readonly sin: number;
  /** Horizontal translation, world units. */
  readonly x: number;
  /** Vertical translation, world units. */
  readonly y: number;
}

/** The transform that leaves every point where it is. */
export const IDENTITY_TRANSFORM: RigidTransform = { cos: 1, sin: 0, x: 0, y: 0 };

/**
 * The transform from an object's own frame to its parent's frame: rotate by `rotation` about the
 * origin, then translate by (`x`, `y`), as the shared fields define.
 *
 * @param x - The object's `x`, world units in the parent's frame.
 * @param y - The object's `y`, world units in the parent's frame.
 * @param rotation - The object's `rotation`, radians.
 * @returns The object-to-parent transform.
 */
export function placementTransform(x: number, y: number, rotation: number): RigidTransform {
  return { cos: Math.cos(rotation), sin: Math.sin(rotation), x, y };
}

/**
 * Maps a point through a transform.
 *
 * @param transform - The transform to apply.
 * @param point - The point, in the transform's source frame.
 * @returns A new point, in the transform's target frame.
 */
export function applyTransform(transform: RigidTransform, point: Point): Point {
  return {
    x: transform.cos * point.x - transform.sin * point.y + transform.x,
    y: transform.sin * point.x + transform.cos * point.y + transform.y,
  };
}

/**
 * Composes two transforms: the result applies `inner` first, then `outer`. For a child inside a
 * parent, `composeTransforms(parentToBoard, childToParent)` is the child-to-board transform.
 *
 * @param outer - The transform applied second.
 * @param inner - The transform applied first.
 * @returns The composed transform.
 */
export function composeTransforms(outer: RigidTransform, inner: RigidTransform): RigidTransform {
  const translation = applyTransform(outer, { x: inner.x, y: inner.y });
  return {
    cos: outer.cos * inner.cos - outer.sin * inner.sin,
    sin: outer.sin * inner.cos + outer.cos * inner.sin,
    x: translation.x,
    y: translation.y,
  };
}

/**
 * Inverts a transform. A rigid transform is always invertible: rotate back by the opposite angle
 * after undoing the translation.
 *
 * @param transform - The transform to invert.
 * @returns The transform that maps the target frame back to the source frame.
 */
export function invertTransform(transform: RigidTransform): RigidTransform {
  const { cos, sin } = transform;
  return {
    cos,
    sin: -sin,
    x: -(cos * transform.x + sin * transform.y),
    y: -(-sin * transform.x + cos * transform.y),
  };
}
