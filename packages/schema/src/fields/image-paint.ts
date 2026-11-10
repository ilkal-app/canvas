import { z } from 'zod';

import { assetIdSchema } from '../ids/asset-id.js';
import { cropSchema } from '../objects/image-object.js';

import type { Paint } from './paint.js';

// Image paint: a paint's third form, an image asset laid into a shape's
// or frame's box. Re-exported by `paint.ts`, whose `paintSchema` takes it as one branch.

/** How an image paint lays its crop into the object's box. */
export const imageFitSchema = z
  .enum(['fill', 'fit', 'crop', 'tile'])
  .describe(
    'fill stretches the crop to the box; fit shows all of it, letterboxed; crop covers the box, cut centred; tile repeats it at its natural size.',
  );

/** How an image paint lays its crop into the box. */
export type ImageFit = z.output<typeof imageFitSchema>;

/**
 * Validates an image paint: an image asset laid into the object's box, on a shape's
 * fill or a frame's background only. `naturalSize` is stored, as an image object stores it, so
 * the fit and crop need no asset fetch.
 */
export const imagePaintSchema = z
  .strictObject({
    /** Always `'image'`. */
    type: z.literal('image'),
    /** The image asset. */
    assetId: assetIdSchema,
    /** The full-resolution size of the image, in pixels. */
    naturalSize: z
      .strictObject({
        /** Width in pixels. */
        width: z.number().int().positive().describe('Width in pixels.'),
        /** Height in pixels. */
        height: z.number().int().positive().describe('Height in pixels.'),
      })
      .describe('The full-resolution size of the image, in pixels.'),
    /** How the crop is laid into the box. */
    fit: imageFitSchema,
    /** The part of the image used, in fractions of its natural size. */
    crop: cropSchema.describe('The part of the image used, in fractions of its natural size.'),
  })
  .describe(
    "An image fill: { type: 'image', assetId, naturalSize: { width, height }, fit: 'fill' | 'fit' | 'crop' | 'tile', crop: { x, y, width, height } }.",
  );

/** An image laid into the object's box. */
export type ImagePaint = z.output<typeof imagePaintSchema>;

/**
 * Tells whether a paint is an image paint.
 *
 * @param paint - A paint, or null.
 * @returns True for `{ type: 'image', … }`.
 */
export function isImagePaint(paint: Paint | null): paint is ImagePaint {
  return paint !== null && !Array.isArray(paint) && (paint as { type?: unknown }).type === 'image';
}
