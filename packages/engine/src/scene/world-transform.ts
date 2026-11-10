import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SceneSource } from './scene-source.js';

/**
 * The map from an object's own frame to the world: rotate by the angle whose cosine and sine
 * are given, then translate by (`x`, `y`). Rigid, like every transform in the document model
 * (objects have a position and a rotation, no scale).
 */
export interface WorldTransform {
  /** Cosine of the rotation. */
  readonly cos: number;
  /** Sine of the rotation; positive turns clockwise on a y-down screen. */
  readonly sin: number;
  /** World x of the object's local origin, world units. */
  readonly x: number;
  /** World y of the object's local origin, world units. */
  readonly y: number;
}

/**
 * Composes an object's placement with every ancestor's, up to the board: its own frame is its
 * parent's translated by (`x`, `y`) and then rotated by `rotation` about that point (the schema's
 * frame convention, `@canvas/schema` `baseObjectSchema`). A parent missing from the source ends
 * the walk as if the object were at the root, and so does a parent cycle, which `validateBoard`
 * reports: the renderer draws something rather than failing the frame.
 *
 * @param object - The object.
 * @param source - The document, to read ancestors from.
 * @returns The object-to-world transform.
 */
export function worldTransformOf(object: BoardObject, source: SceneSource): WorldTransform {
  let cos = Math.cos(object.rotation);
  let sin = Math.sin(object.rotation);
  let x = object.x;
  let y = object.y;
  let parent = object.parentId === null ? undefined : source.get(object.parentId);
  if (parent === undefined) return { cos, sin, x, y };
  const visited = new Set<ObjectId>([object.id]);
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    const parentCos = Math.cos(parent.rotation);
    const parentSin = Math.sin(parent.rotation);
    [cos, sin] = [parentCos * cos - parentSin * sin, parentSin * cos + parentCos * sin];
    [x, y] = [parentCos * x - parentSin * y + parent.x, parentSin * x + parentCos * y + parent.y];
    parent = parent.parentId === null ? undefined : source.get(parent.parentId);
  }
  return { cos, sin, x, y };
}
