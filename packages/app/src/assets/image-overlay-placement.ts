import type { BoardReader } from '@canvas/document';
import { worldToScreen, type Camera } from '@canvas/engine';
import {
  applyTransform,
  composeTransforms,
  placementTransform,
  shownPageIdOf,
  type AssetId,
  type Board,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

/**
 * The objects that carry an upload's state overlay: an image, and a shape or frame filled with
 * one. An instance whose image child was replaced carries none: its overlay's
 * Cancel and Remove would need to undo the override, not the instance.
 */
const SHOWS_IMAGE: ReadonlySet<string> = new Set(['image', 'shape', 'frame']);

/** Where an image's state overlay goes: the image's box on screen, CSS px. */
export interface ImageOverlayRect {
  /** Its top-left corner's left, CSS px. */
  readonly left: number;
  /** Its top-left corner's top, CSS px. */
  readonly top: number;
  /** Its width on screen, CSS px. */
  readonly width: number;
  /** Its height on screen, CSS px. */
  readonly height: number;
  /** Its rotation about its top-left corner, degrees clockwise (its frames' included). */
  readonly rotationDeg: number;
}

/**
 * Where an image's state overlay goes (the state shows over the image itself):
 * its box on screen, its parents' frames composed, turned as it is. The object is an image, or a
 * shape or frame whose image fill is uploading. Pure.
 *
 * @param board - The document.
 * @param id - The object.
 * @param camera - The camera on screen.
 * @returns The box, or undefined when the object is gone or cannot show an image.
 */
export function imageOverlayRectOf(
  board: Pick<BoardReader, 'get'>,
  id: ObjectId,
  camera: Camera,
): ImageOverlayRect | undefined {
  const object = board.get(id);
  if (object === undefined || !SHOWS_IMAGE.has(object.type) || !('width' in object)) {
    return undefined;
  }
  let transform = placementTransform(object.x, object.y, object.rotation);
  let parentId = object.parentId;
  const seen = new Set<ObjectId>([id]);
  while (parentId !== null && !seen.has(parentId)) {
    const parent = board.get(parentId);
    if (parent === undefined) break;
    seen.add(parentId);
    transform = composeTransforms(
      placementTransform(parent.x, parent.y, parent.rotation),
      transform,
    );
    parentId = parent.parentId;
  }
  const corner = worldToScreen(camera, applyTransform(transform, { x: 0, y: 0 }));
  return {
    left: corner.x,
    top: corner.y,
    width: object.width * camera.zoom,
    height: object.height * camera.zoom,
    rotationDeg: (Math.atan2(transform.sin, transform.cos) * 180) / Math.PI,
  };
}

/**
 * The image objects on the page shown that show one of some assets: a collaborator's images
 * still processing, whose spinners follow them. Read once per report, never per frame. Pure.
 *
 * @param board - The board.
 * @param assetIds - The assets.
 * @param pageId - The page shown; every page when absent.
 * @returns The objects, in the board's order.
 */
export function imageObjectsOf(
  board: Board,
  assetIds: readonly AssetId[],
  pageId: PageId | undefined,
): ObjectId[] {
  if (assetIds.length === 0) return [];
  const wanted = new Set(assetIds);
  const ids: ObjectId[] = [];
  for (const object of board.objects.values()) {
    if (object.type !== 'image' || !wanted.has(object.assetId)) continue;
    if (pageId === undefined || shownPageIdOf(board, object) === pageId) ids.push(object.id);
  }
  return ids;
}
