import { fittedImageRect, type Crop, type Rgba } from '@canvas/schema';

import type { SceneObject } from '../scene/scene-pass.js';

import { PLACEHOLDER_PAGE } from './texture-pages.js';
import type { UnitRect } from './tiles.js';

/** A rectangle of a texture page, in its UV coordinates (0 to 1, v down). */
export interface PageRegion {
  /** The page (`TexturePages`). */
  readonly page: number;
  /** Left edge. */
  readonly u0: number;
  /** Top edge. */
  readonly v0: number;
  /** Right edge. */
  readonly u1: number;
  /** Bottom edge. */
  readonly v1: number;
}

/** Resident pixels of an image: a page region and the part of the image it holds. */
export interface ImageSource {
  /** Where the pixels are. */
  readonly region: PageRegion;
  /** The part of the image they show, in its unit square: the whole for a level, less for a tile. */
  readonly covers: UnitRect;
}

/** One quad an image record draws: a part of the image, and the pixels it is drawn from. */
export interface BindingPart {
  /** The part of the source image the quad shows, in its unit square (inside the crop). */
  readonly rect: UnitRect;
  /** The pixels, or undefined to draw the placeholder colour. */
  readonly source: ImageSource | undefined;
}

/**
 * What an image object's records draw this frame (the texture manager decides): one part for
 * an untiled image (the whole crop, from the level shown), or one per visible tile of a tiled
 * image, each from its tile or, until the tile is resident, from the level shown. Parts never
 * overlap, so a translucent image blends once and page order does not matter.
 */
export interface ImageBinding {
  /** The placeholder colour: the image's average colour, straight alpha. */
  readonly color: Rgba;
  /** The quads, one per record from record 0; records past them draw nothing. */
  readonly parts: readonly BindingPart[];
}

/**
 * The placeholder colour of an image whose description has not arrived: a light grey.
 */
export const UNKNOWN_IMAGE_COLOR: Rgba = [0.86, 0.86, 0.86, 1];

/** The whole unit square. */
export const WHOLE_IMAGE: UnitRect = { minU: 0, minV: 0, maxU: 1, maxV: 1 };

/**
 * A crop as a unit rectangle.
 *
 * @param crop - The crop.
 * @returns The same rectangle.
 */
export function cropRect(crop: Crop): UnitRect {
  return { minU: crop.x, minV: crop.y, maxU: crop.x + crop.width, maxV: crop.y + crop.height };
}

function isSameRect(a: UnitRect, b: UnitRect): boolean {
  return a.minU === b.minU && a.minV === b.minV && a.maxU === b.maxU && a.maxV === b.maxV;
}

function isSameSource(a: ImageSource | undefined, b: ImageSource | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const { region: p, covers } = a;
  const { region: q } = b;
  return (
    p.page === q.page &&
    p.u0 === q.u0 &&
    p.v0 === q.v0 &&
    p.u1 === q.u1 &&
    p.v1 === q.v1 &&
    isSameRect(covers, b.covers)
  );
}

/**
 * The binding of an image with no pixels yet: the whole crop in a flat colour.
 *
 * @param color - The colour, straight alpha.
 * @returns The binding.
 */
export function placeholderBinding(color: Rgba): ImageBinding {
  return { color, parts: [{ rect: WHOLE_IMAGE, source: undefined }] };
}

/**
 * Whether two bindings draw the same thing, so the object's records need no rewrite. Pure.
 *
 * @param a - One binding.
 * @param b - The other.
 * @returns True when every part and the colour match.
 */
export function isSameBinding(a: ImageBinding, b: ImageBinding): boolean {
  if (a.parts.length !== b.parts.length || a.color.some((channel, i) => channel !== b.color[i])) {
    return false;
  }
  return a.parts.every((part, index) => {
    const other = b.parts[index];
    return (
      other !== undefined &&
      isSameRect(part.rect, other.rect) &&
      isSameSource(part.source, other.source)
    );
  });
}

/**
 * The page a record samples: its part's source page, or the placeholder; a record past the
 * parts takes the last part's.
 *
 * @param binding - The object's binding.
 * @param recordIndex - The record.
 * @returns The page.
 */
export function pageOfPart(binding: ImageBinding, recordIndex: number): number {
  // A record past the parts draws nothing: it takes the last part's page, so an image's empty
  // tile records add no page to its draws.
  const part = binding.parts[Math.min(recordIndex, binding.parts.length - 1)];
  return part?.source?.region.page ?? PLACEHOLDER_PAGE;
}

/**
 * Fills one image record (the image pass's layout: placement, quad, UV rectangle, clamp
 * rectangle, colour, opacity and texture weight; see `image.wgsl`). The quad covers the part of
 * the crop where `fittedImageRect` draws it, so an image is never drawn stretched. A record with no part, or
 * whose part lies outside the crop, stays zero and draws nothing. Pure apart from writing
 * `record`.
 *
 * @param record - The zero-filled record, 22 floats.
 * @param target - The image object and its world transform.
 * @param binding - What the object draws.
 * @param recordIndex - Which record.
 */
export function writeImageRecord(
  record: Float32Array,
  target: SceneObject,
  binding: ImageBinding,
  recordIndex: number,
): void {
  const { object, transform } = target;
  const part = binding.parts[recordIndex];
  if (part === undefined || object.type !== 'image') return;
  const crop = cropRect(object.crop);
  const shown = intersect(part.rect, crop);
  if (shown === undefined) return;
  // Where the crop draws in the box: the box itself, or fitted inside it at the crop's own
  // aspect when a merge left the box off it (`fittedImageRect`): never stretched.
  const drawn = fittedImageRect(object);
  const scaleX = drawn.width / (crop.maxU - crop.minU);
  const scaleY = drawn.height / (crop.maxV - crop.minV);
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = transform.cos;
  record[3] = transform.sin;
  record[4] = drawn.x + (shown.minU - crop.minU) * scaleX;
  record[5] = drawn.y + (shown.minV - crop.minV) * scaleY;
  record[6] = (shown.maxU - shown.minU) * scaleX;
  record[7] = (shown.maxV - shown.minV) * scaleY;
  const { source } = part;
  const region = source?.region ?? { page: PLACEHOLDER_PAGE, u0: 0, v0: 0, u1: 1, v1: 1 };
  const covers = source?.covers ?? WHOLE_IMAGE;
  const toU = (u: number): number =>
    region.u0 + ((u - covers.minU) / (covers.maxU - covers.minU)) * (region.u1 - region.u0);
  const toV = (v: number): number =>
    region.v0 + ((v - covers.minV) / (covers.maxV - covers.minV)) * (region.v1 - region.v0);
  record[8] = toU(shown.minU);
  record[9] = toV(shown.minV);
  record[10] = toU(shown.maxU);
  record[11] = toV(shown.maxV);
  record[12] = region.u0;
  record[13] = region.v0;
  record[14] = region.u1;
  record[15] = region.v1;
  [record[16], record[17], record[18], record[19]] = binding.color;
  // The image's opacity is its record's trailing transparency, as every object's is
  // (`SceneOpacity`), or its layer's when it is one (a translucent bordered image).
  record[20] = 1;
  record[21] = source === undefined ? 0 : 1;
}

function intersect(a: UnitRect, b: UnitRect): UnitRect | undefined {
  const minU = Math.max(a.minU, b.minU);
  const minV = Math.max(a.minV, b.minV);
  const maxU = Math.min(a.maxU, b.maxU);
  const maxV = Math.min(a.maxV, b.maxV);
  return maxU > minU && maxV > minV ? { minU, minV, maxU, maxV } : undefined;
}
