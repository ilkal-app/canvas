import { z } from 'zod';

import { linkShape } from '../fields/link.js';
import { opacitySchema } from '../fields/opacity.js';
import { strokeSchema } from '../fields/stroke.js';
import { visibilityShape } from '../fields/visibility.js';
import { assetIdSchema } from '../ids/asset-id.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * Slack for floating-point sums such as `0.1 + 0.9` when checking a crop stays inside the image:
 * `cropSchema` and the drawable range of a crop (`cropReason`) both allow it.
 */
export const CROP_EDGE_SLACK = 1e-9;

/**
 * Validates a crop rectangle in the unit square of the source image: `x`, `y` from its top-left
 * corner and `width`, `height` as fractions of its natural size, so the crop is independent of
 * which pyramid level is loaded. The rectangle lies inside the image
 * and is not empty. `{ x: 0, y: 0, width: 1, height: 1 }` shows the whole image.
 */
export const cropSchema = z
  .strictObject({
    /** Left edge as a fraction of the natural width. */
    x: z.number().min(0).max(1).describe('Left edge as a fraction of the natural width.'),
    /** Top edge as a fraction of the natural height. */
    y: z.number().min(0).max(1).describe('Top edge as a fraction of the natural height.'),
    /** Width as a fraction of the natural width. */
    width: z.number().positive().max(1).describe('Width as a fraction of the natural width.'),
    /** Height as a fraction of the natural height. */
    height: z.number().positive().max(1).describe('Height as a fraction of the natural height.'),
  })
  .superRefine((crop, context) => {
    if (crop.x + crop.width > 1 + CROP_EDGE_SLACK) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'the crop extends past the right edge',
        input: crop,
      });
    }
    if (crop.y + crop.height > 1 + CROP_EDGE_SLACK) {
      context.addIssue({
        code: 'custom',
        path: ['height'],
        message: 'the crop extends past the bottom edge',
        input: crop,
      });
    }
  });

/** A crop rectangle, in fractions of the source image's natural size. */
export type Crop = z.output<typeof cropSchema>;

/**
 * Validates an image object: an asset shown in a box. The box
 * (`width`, `height`) is the displayed size in world units; the asset's bytes live in object
 * storage and only `assetId` is stored.
 */
export const imageObjectSchema = baseObjectSchema
  .extend({
    /** Always `'image'`: the discriminator of this object type. */
    type: z.literal('image'),
    ...boxShape,
    /** The image asset in object storage. */
    assetId: assetIdSchema,
    /** The part of the source image shown, in fractions of its natural size. */
    crop: cropSchema.describe(
      'The part of the source image shown, in fractions of its natural size.',
    ),
    /** The full-resolution size of the source image, in pixels. */
    naturalSize: z
      .strictObject({
        /** Source image width in pixels. */
        width: z.number().int().positive().describe('Source image width in pixels.'),
        /** Source image height in pixels. */
        height: z.number().int().positive().describe('Source image height in pixels.'),
      })
      .describe('The full-resolution size of the source image, in pixels.'),
    /** Opacity from 0 (invisible) to 1 (opaque). */
    opacity: opacitySchema,
    ...visibilityShape,
    ...linkShape,
    /** A stroke drawn inside the box's edge, or null or absent for none. */
    border: strokeSchema
      .nullable()
      .optional()
      .describe(
        "A stroke drawn inside the image's edge { color, width }, or null or absent for none.",
      ),
  })
  .describe('An image asset shown in a box.');

/** An image object. */
export type ImageObject = z.output<typeof imageObjectSchema>;
