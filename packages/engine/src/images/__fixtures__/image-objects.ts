// Image object builders for the texture manager's and the image pass's tests.
import type { AssetId, ImageObject, ObjectId, PrincipalId } from '@canvas/schema';

/**
 * An image object with test defaults: a 400 × 300 box at the origin showing the whole of a
 * 4000 × 3000 asset `photo`, opaque, unrotated.
 *
 * @param overrides - Fields to change.
 * @returns The object.
 */
export function imageObject(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'image-1' as ObjectId,
    type: 'image',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'system' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    width: 400,
    height: 300,
    assetId: 'photo' as AssetId,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 4000, height: 3000 },
    opacity: 1,
    ...overrides,
  };
}
