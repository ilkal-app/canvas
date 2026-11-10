import { z } from 'zod';

import { colorSchema } from '../fields/color.js';
import { linkShape } from '../fields/link.js';
import { layerShape } from '../fields/opacity.js';
import { refineRuns } from '../fields/text-content.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema, boxShape } from './base-object.js';
import { textBoxShape } from './text-object.js';

/**
 * A sticky note's proportions: `square`, today's note, at least as tall as it is wide;
 * `wide`, a 2:1 note, at least half as tall as it is wide. Either grows downwards with its text.
 */
export const STICKY_ASPECTS = ['square', 'wide'] as const;

/** One of {@link STICKY_ASPECTS}. */
export type StickyAspect = (typeof STICKY_ASPECTS)[number];

/** Validates a sticky's aspect; absent means square. */
export const stickyAspectSchema = z
  .enum(STICKY_ASPECTS)
  .optional()
  .describe("The note's proportions: square (the default) or wide (2:1); it grows with its text.");

/**
 * Validates a sticky note: a text object with a background colour. A
 * sticky has a fixed width and grows downwards with its content, so `autoWidth` is always
 * `false`; `height` is the measured height, which the layout keeps at least square as the
 * prototype does (`src/board/note.ts`), or at least half as tall as it is wide for a wide note
 * (`aspect`). The schema does not check that layout rule.
 */
export const stickyObjectSchema = baseObjectSchema
  .extend({
    /** Always `'sticky'`: the discriminator of this object type. */
    type: z.literal('sticky'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    ...boxShape,
    ...textBoxShape,
    /** Always false: a sticky has a fixed width. */
    autoWidth: z.literal(false).describe('Always false: a sticky has a fixed width.'),
    /** The note background colour. */
    color: colorSchema.describe('The note background colour: a tuple or a board colour token.'),
    /** The note's proportions; absent is square. */
    aspect: stickyAspectSchema,
    ...linkShape,
  })
  .superRefine(refineRuns)
  .describe('A sticky note: fixed-width text on a coloured square that grows with its content.');

/** A sticky note. */
export type StickyObject = z.output<typeof stickyObjectSchema>;
