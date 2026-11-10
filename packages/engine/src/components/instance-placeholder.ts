import type { InstanceObject, ObjectId, ShapeObject } from '@canvas/schema';

/** The largest integer key: the placeholder draws above every resolved child it outlines. */
const TOPMOST_Z = `z${'z'.repeat(26)}`;

/**
 * Gives unresolved or empty retained instances a visible outline owned by the real instance.
 *
 * @param instance - Real instance placement; the placeholder uses its local coordinates.
 * @returns A transient ordinary shape, never written to the document.
 */
export function instancePlaceholder(instance: InstanceObject): ShapeObject {
  return {
    id: `${instance.id}/$placeholder` as ObjectId,
    type: 'shape',
    parentId: instance.id,
    pageId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: TOPMOST_Z,
    locked: false,
    createdBy: instance.createdBy,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    width: instance.width,
    height: instance.height,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    fill: null,
    stroke: { color: [0.4, 0.4, 0.4, 1], width: 2 },
  };
}
