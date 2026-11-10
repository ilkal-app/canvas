import { generateKeyBetween } from '@canvas/document';
import {
  imagePaintImageFrame,
  isImagePaint,
  type Crop,
  type FrameObject,
  type ImagePaint,
  type ShapeObject,
} from '@canvas/schema';

import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';

import { CropMode, type CropModeContext, type CropTarget } from './crop-mode.js';

/** The whole image, uncropped. */
const WHOLE_IMAGE: Crop = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** An object whose fill can be an image: a shape's fill, a frame's background. */
type FilledObject = ShapeObject | FrameObject;

/**
 * An object's image fill, if its fill (a shape's) or background (a frame's) is one.
 *
 * @param object - The object.
 * @returns The paint, or undefined.
 */
function imageFillOf(object: FilledObject): ImagePaint | undefined {
  const paint = object.type === 'shape' ? object.fill : object.background;
  return isImagePaint(paint) ? paint : undefined;
}

/**
 * The object with its image fill's crop replaced, as the crop mode previews it.
 *
 * @param object - The object.
 * @param paint - Its image fill.
 * @param crop - The crop.
 * @returns The object.
 */
function withFillCrop(object: FilledObject, paint: ImagePaint, crop: Crop): FilledObject {
  const fill = { ...paint, crop: { ...crop } };
  return object.type === 'shape' ? { ...object, fill } : { ...object, background: fill };
}

/**
 * A stacking key just below an object among its siblings: above the sibling before it, so the
 * whole image drawn there shows under the object and over what is under it.
 *
 * @param context - The mode's context, for the document.
 * @param object - The object.
 * @returns The key.
 */
function keyBelow(context: CropModeContext, object: FilledObject): string {
  let below: string | null = null;
  for (const id of context.store.references.childrenOf(object.parentId)) {
    const z = context.store.get(id)?.z;
    if (z !== undefined && z < object.z && (below === null || z > below)) below = z;
  }
  return generateKeyBetween(below, object.z);
}

/**
 * The whole image of an object's image fill beside it (a preview, never written): an unstroked
 * rectangle in the object's parent, placed where `imagePaintImageFrame` lays the whole image in
 * the object's box, turned with the object, just below it in the stack, filled with the same
 * image stretched across it (fit `fill`, the whole crop). Not an image object: those are never
 * stretched, and a fill's `fill` fit stretches its image, so only a stretched rectangle lines up
 * with the fill on every fit.
 *
 * @param context - The mode's context, for the document and a fresh id.
 * @param object - The object.
 * @param paint - Its image fill.
 * @returns The rectangle.
 */
function wholeImageOf(
  context: CropModeContext,
  object: FilledObject,
  paint: ImagePaint,
): ShapeObject {
  const local = imagePaintImageFrame(paint, object);
  const corner = boxPointToWorld(object, local);
  return {
    id: context.environment.createId(),
    type: 'shape',
    parentId: object.parentId,
    pageId: object.pageId,
    x: corner.x,
    y: corner.y,
    rotation: object.rotation,
    z: keyBelow(context, object),
    locked: false,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: local.width,
    height: local.height,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    stroke: null,
    fill: { ...paint, fit: 'fill', crop: WHOLE_IMAGE },
    label: null,
  };
}

/**
 * An image fill's crop: the object keeps its box and previews its fill with the draft
 * crop, in its own fit; the whole image shows just below it while cropping (`wholeImageOf`); a
 * commit writes the fill (a shape's) or background (a frame's) as stored when it commits, with only
 * `crop` changed, and nothing when that image is no longer the fill.
 *
 * @param context - The mode's context.
 * @param object - The object.
 * @param paint - Its image fill.
 * @returns The target.
 */
function fillCropTarget(
  context: CropModeContext,
  object: FilledObject,
  paint: ImagePaint,
): CropTarget {
  let whole: ShapeObject | undefined;
  return {
    id: object.id,
    crop: paint.crop,
    show: (draft) => {
      if (whole === undefined) {
        whole = wholeImageOf(context, object, paint);
        context.setPreview(whole.id, whole);
      }
      context.setPreview(object.id, withFillCrop(object, paint, draft));
    },
    hide: () => {
      context.setPreview(object.id, undefined);
      if (whole !== undefined) context.setPreview(whole.id, undefined);
    },
    // The paint as it is when the crop commits, so a fit a collaborator changed meanwhile is
    // kept; a crop of another image (replaced meanwhile), or of an image fill no longer there,
    // writes nothing.
    styleOf: (crop) => {
      const stored = context.store.get(object.id);
      const now =
        stored?.type === 'shape' || stored?.type === 'frame' ? imageFillOf(stored) : undefined;
      if (now?.assetId !== paint.assetId) return undefined;
      const fill = { ...now, crop: { ...crop } };
      return object.type === 'shape' ? { fill } : { background: fill };
    },
  };
}

/**
 * The crop mode of a shape's or frame's image fill (the paint control's "Crop image…"):
 * the image crop mode's handles, box, keys, Enter and Escape over the whole image, which lies
 * where the fill's fit lays it in the object's box when the mode starts and stays put; the box
 * never changes, and the fill previews the draft crop in its own fit. Enter commits one
 * `setStyle` of the fill or background, only its crop changed. None for a locked object or one
 * whose fill is not an image.
 *
 * @param context - The document, the preview and the router's callbacks.
 * @param object - The shape or frame as stored.
 * @param frame - Its box on the board, world units (`orientedBoxOf`).
 * @returns The mode, or undefined.
 */
export function fillCropModeOf(
  context: CropModeContext,
  object: ShapeObject | FrameObject,
  frame: OrientedBox,
): CropMode | undefined {
  const paint = imageFillOf(object);
  if (object.locked || paint === undefined) return undefined;
  const local = imagePaintImageFrame(paint, frame);
  const corner = boxPointToWorld(frame, local);
  const full: OrientedBox = {
    ...corner,
    width: local.width,
    height: local.height,
    rotation: frame.rotation,
  };
  return new CropMode(context, fillCropTarget(context, object, paint), full);
}
