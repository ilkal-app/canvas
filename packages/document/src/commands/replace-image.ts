import { z } from 'zod';

import { assetIdSchema, objectIdSchema, type ObjectId } from '@canvas/schema';

import { checkObject, movabilityErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { replacedCrop } from './image-cover-crop.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';

/** Validates `replaceImage`'s input. */
export const replaceImageInputSchema = z
  .strictObject({
    /** The image whose picture is replaced. */
    id: objectIdSchema.describe('The image whose picture is replaced.'),
    /** The new picture's asset. */
    assetId: assetIdSchema.describe("The new picture's asset."),
    /** The new picture's size, px. */
    naturalSize: z
      .strictObject({
        /** Its width, px. */
        width: z.number().int().positive().describe('Its width, px.'),
        /** Its height, px. */
        height: z.number().int().positive().describe('Its height, px.'),
      })
      .describe("The new picture's size, px."),
  })
  .describe('Replaces an image’s picture, keeping its box and, where it fits, its crop.');

/** What `replaceImage` writes. */
export interface ReplaceImagePlan {
  /** The image's asset, natural size and crop. */
  readonly patch: PlannedPatch;
}

/** What `replaceImage` did. */
export interface ReplaceImageResult {
  /** The image. */
  readonly id: ObjectId;
}

/**
 * `replaceImage` (the image popover's Replace): an image shows another picture — its
 * asset and natural size — in the same box (place, size and rotation untouched), keeping its crop
 * where, in the new picture, it still shows the box's shape, else the centred cover crop
 * (`replacedCrop`). Refused for a missing object, a non-image and a locked image. One
 * transaction, so one undo step.
 */
export const replaceImageCommand: Command<
  typeof replaceImageInputSchema,
  ReplaceImagePlan,
  ReplaceImageResult
> = {
  name: 'replaceImage',
  description: 'Replaces an image’s picture, keeping its box and, where it fits, its crop.',
  input: replaceImageInputSchema,
  validate(context, input) {
    const { board } = context;
    const image = board.get(input.id);
    if (image === undefined) {
      const message = `there is no object "${input.id}"`;
      return reject([commandError('missing-object', input.id, ['id'], message)]);
    }
    if (image.type !== 'image') {
      const message = `"${input.id}" is not an image`;
      return reject([commandError('invalid-input', input.id, ['id'], message)]);
    }
    const locked = movabilityErrors(board, image, ['id'], new Set([input.id]));
    if (locked.length > 0) return reject(locked);
    const { assetId, naturalSize } = input;
    const crop = replacedCrop(image.crop, image, naturalSize);
    const errors: CommandError[] = [];
    checkObject(board, { ...image, assetId, naturalSize, crop }, errors);
    if (errors.length > 0) return reject(errors);
    return accept({ patch: { id: image.id, patch: { assetId, naturalSize, crop } } });
  },
  apply(transaction, input, plan) {
    applyPatches(transaction, [plan.patch]);
    return { id: plan.patch.id };
  },
};
