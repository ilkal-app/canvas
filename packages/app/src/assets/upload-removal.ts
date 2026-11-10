import type { BoardReader } from '@canvas/document';
import { isImagePaint, type AssetId, type ObjectId, type Paint } from '@canvas/schema';

/** One object's style change: the field an abandoned image fill is cleared from. */
export interface UploadStyleChange {
  /** The object. */
  readonly id: ObjectId;
  /** Its new fill or background: none. */
  readonly style: { readonly fill: null } | { readonly background: null };
}

/** What abandoning an upload does to the objects it names. */
export interface UploadRemoval {
  /** The images the upload placed, deleted (with any already gone, as before). */
  readonly deleted: readonly ObjectId[];
  /** The shapes and frames filled with the asset, their fill or background cleared. */
  readonly cleared: readonly UploadStyleChange[];
}

/**
 * Whether a paint is an image fill of an asset.
 *
 * @param paint - The paint.
 * @param assetId - The asset.
 * @returns True when it shows that asset.
 */
function isFillOf(paint: Paint | null, assetId: AssetId): boolean {
  return isImagePaint(paint) && paint.assetId === assetId;
}

/**
 * What a cancelled upload, or one removed after it failed, does to the objects it names: an image
 * object is deleted, as the image is all it is (an id already gone is passed on with them, which
 * deletes nothing); a shape or frame filled with the asset keeps everything else and only loses
 * that fill or background. A shape or frame no longer showing the asset (its fill changed
 * meanwhile), and any other object (an instance whose image was replaced), are left alone. Pure.
 *
 * @param board - The document.
 * @param assetId - The upload's asset.
 * @param ids - The objects the upload names.
 * @returns The deletions and the style changes.
 */
export function uploadRemovalOf(
  board: Pick<BoardReader, 'get'>,
  assetId: AssetId,
  ids: readonly ObjectId[],
): UploadRemoval {
  const deleted: ObjectId[] = [];
  const cleared: UploadStyleChange[] = [];
  for (const id of ids) {
    const object = board.get(id);
    if (object === undefined || object.type === 'image') deleted.push(id);
    else if (object.type === 'shape' && isFillOf(object.fill, assetId)) {
      cleared.push({ id, style: { fill: null } });
    } else if (object.type === 'frame' && isFillOf(object.background, assetId)) {
      cleared.push({ id, style: { background: null } });
    }
  }
  return { deleted, cleared };
}
