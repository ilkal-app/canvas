import { generateNKeysBetween } from '@canvas/document';
import type { ObjectId, PrincipalId, ShapeObject } from '@canvas/schema';

/**
 * A harness-only 600-shape selection fixture: 30 columns by 20 rows, wholly visible at 100%.
 * It exceeds the 500-outline cap without changing the demo board or issuing test commands.
 *
 * @returns Fresh rectangles spanning (40,40) to (485,335), in deterministic z order.
 */
export function createSelectionCapBoard(): ShapeObject[] {
  const keys = generateNKeysBetween(null, null, 600);
  return keys.map((z, index) => ({
    id: `selection-cap-${String(index)}` as ObjectId,
    type: 'shape',
    parentId: null,
    x: 40 + (index % 30) * 15,
    y: 40 + Math.floor(index / 30) * 15,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_767_225_600_000,
    updatedAt: 1_767_225_600_000,
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    fill: [0.2, 0.6, 0.4, 1],
    stroke: null,
    label: null,
  }));
}
