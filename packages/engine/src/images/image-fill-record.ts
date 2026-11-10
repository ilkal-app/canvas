import { imagePaintLayout, type ImagePaint, type ImagePaintMode } from '@canvas/schema';

import type { GpuVertexAttribute } from '../gpu/vertex-layout.js';
import type { PassLevelOfDetail } from '../lod/level-of-detail.js';
import { IMAGE_LOD_RULE } from '../lod/lod-thresholds.js';

import { pageOfPart, WHOLE_IMAGE, type ImageBinding } from './image-binding.js';

// The image-fill record: what `sdf-shape-image` reads after the SDF
// shape record to sample an image paint's page at the fragment's point of the box
// (scripts/image-fill-shader.ts).

/** Floats the image-fill tail adds after the SDF shape record. */
export const IMAGE_FILL_TAIL_FLOATS = 14;

/** The tail's instance attributes, at the locations `sdf-shape-image` reads them. */
export const IMAGE_FILL_TAIL_ATTRIBUTES: readonly GpuVertexAttribute[] = [
  { location: 8, format: 'float32x4' },
  { location: 9, format: 'float32x4' },
  { location: 10, format: 'float32x4' },
  { location: 11, format: 'float32x2' },
];

/** The page a placeholder binding samples (any page: its texture weight is 0). */
const NO_REGION = { u0: 0, v0: 0, u1: 1, v1: 1 } as const;

/** Each sampling mode's code in the record, as `imageFill` reads it. */
const MODE_CODES: Readonly<Record<ImagePaintMode, number>> = { clamp: 0, letterbox: 1, repeat: 2 };

/**
 * Writes an image fill's tail into a record, after the SDF shape record: the page UVs of the
 * crop's corners (`uvRect`), the page region samples stay in (`clampRect`), the map from the
 * box's unit point to the drawn rectangle (`imageFit`), then the texture weight (1 when a level
 * is bound and the full form is drawn; 0 draws the placeholder colour the caller writes at floats
 * 4 to 7) and the sampling mode. Pure but for the record.
 *
 * @param record - The record.
 * @param offset - Where the tail starts: the SDF shape record's length.
 * @param box - The object's box, world units.
 * @param box.width - The width.
 * @param box.height - The height.
 * @param paint - Its image paint.
 * @param binding - What the texture manager has bound for it.
 * @param isAverage - Whether the level-of-detail rule draws its average colour.
 */
export function writeImageFillTail(
  record: Float32Array,
  offset: number,
  box: { readonly width: number; readonly height: number },
  paint: ImagePaint,
  binding: ImageBinding,
  isAverage: boolean,
): void {
  const { drawn, crop, mode } = imagePaintLayout(paint, box);
  const source = binding.parts[0]?.source;
  const region = source?.region ?? NO_REGION;
  const covers = source?.covers ?? WHOLE_IMAGE;
  const toU = (u: number): number =>
    region.u0 + ((u - covers.minU) / (covers.maxU - covers.minU)) * (region.u1 - region.u0);
  const toV = (v: number): number =>
    region.v0 + ((v - covers.minV) / (covers.maxV - covers.minV)) * (region.v1 - region.v0);
  record[offset] = toU(crop.x);
  record[offset + 1] = toV(crop.y);
  record[offset + 2] = toU(crop.x + crop.width);
  record[offset + 3] = toV(crop.y + crop.height);
  record[offset + 4] = region.u0;
  record[offset + 5] = region.v0;
  record[offset + 6] = region.u1;
  record[offset + 7] = region.v1;
  const isDrawn = drawn.width > 0 && drawn.height > 0;
  record[offset + 8] = isDrawn ? box.width / drawn.width : 0;
  record[offset + 9] = isDrawn ? box.height / drawn.height : 0;
  record[offset + 10] = isDrawn ? (0 - drawn.x) / drawn.width : 0;
  record[offset + 11] = isDrawn ? (0 - drawn.y) / drawn.height : 0;
  record[offset + 12] = source === undefined || isAverage ? 0 : 1;
  record[offset + 13] = MODE_CODES[mode];
}

/**
 * The page an image fill's record draws from: its binding's level's, or the placeholder page.
 *
 * @param binding - Its binding.
 * @returns The page.
 */
export function pageOfImageFill(binding: ImageBinding): number {
  return pageOfPart(binding, 0);
}

/**
 * The level-of-detail rule of an image fill: a fill whose box's
 * longer side is under 8 device pixels draws its image's average colour (`IMAGE_LOD_RULE`), as an
 * image object does; the texture manager keeps its smallest level resident, so returning to the
 * texture is immediate and the fill is never blank.
 */
export const IMAGE_FILL_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: IMAGE_LOD_RULE,
  sizeOf: (object) => ('width' in object ? Math.max(object.width, object.height) : 0),
  isSameSize: (previous, next) =>
    'width' in previous &&
    'width' in next &&
    previous.width === next.width &&
    previous.height === next.height,
};
