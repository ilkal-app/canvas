import { z } from 'zod';

import { visibilityShape } from '../fields/visibility.js';
import { assetIdSchema } from '../ids/asset-id.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * Validates a trim: the part of the video that plays, from `startMs` to `endMs` in milliseconds
 * of source time, with `endMs > startMs`.
 */
export const trimSchema = z
  .strictObject({
    /** Where playback starts, ms into the source. */
    startMs: z.number().nonnegative().describe('Where playback starts, ms into the source.'),
    /** Where playback ends, ms into the source. */
    endMs: z.number().positive().describe('Where playback ends, ms into the source.'),
  })
  .refine((trim) => trim.endMs > trim.startMs, {
    message: 'endMs must be after startMs',
    path: ['endMs'],
  });

/** The played part of a video, in milliseconds of source time. */
export type Trim = z.output<typeof trimSchema>;

/**
 * Validates a video object: a transcoded asset shown in a box. Playback
 * state (playing, current time) is per client and never stored; a "play for everyone" action is
 * presence, not document.
 */
export const videoObjectSchema = baseObjectSchema
  .extend({
    /** Always `'video'`: the discriminator of this object type. */
    type: z.literal('video'),
    ...boxShape,
    /** The transcoded video asset in object storage. */
    assetId: assetIdSchema,
    /** The poster-frame image asset, or null until the server has generated it. */
    poster: assetIdSchema
      .nullable()
      .describe('The poster-frame image asset, or null until the server has generated it.'),
    /** Whether playback restarts at the end. */
    loop: z.boolean().describe('Whether playback restarts at the end.'),
    /** Whether playback is silent; videos are muted by default. */
    muted: z.boolean().describe('Whether playback is silent; videos are muted by default.'),
    /** The part that plays, or null to play the whole video. */
    trim: trimSchema.nullable().describe('The part that plays, or null to play the whole video.'),
    ...visibilityShape,
  })
  .describe('A video asset shown in a box.');

/** A video object. */
export type VideoObject = z.output<typeof videoObjectSchema>;
