import { z } from 'zod';

import { colorModeSchema } from '../fields/color-tokens.js';
import { layerShape } from '../fields/opacity.js';
import { visibilityShape } from '../fields/visibility.js';
import { objectIdSchema } from '../ids/object-id.js';
import { instanceOverridesSchema } from '../instances/instance-overrides.js';
import { variantSelectionSchema } from '../instances/variants.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/** The smallest content scale an instance may store. */
export const INSTANCE_SCALE_MIN = 0.05;

/** The largest content scale an instance may store. */
export const INSTANCE_SCALE_MAX = 20;

/** The most mains a slot's `swapOptions` may list. */
const MAX_SWAP_OPTIONS = 64;

/** A leaf placement of a board-local main; no copied children are stored on the instance. */
export const instanceObjectSchema = baseObjectSchema.extend({
  /** Always `instance`: a reference plus property overrides. */
  type: z.literal('instance'),
  /** The layer's opacity from 0 to 1; absent is opaque. */
  ...layerShape,
  ...visibilityShape,
  ...boxShape,
  /** The immutable main definition reference, stored in the identity group. */
  mainId: objectIdSchema.describe('The immutable reference to a board-local main.'),
  /** Per-descendant replacement records, independently merged by source path. */
  overrides: instanceOverridesSchema.describe(
    'Independent replacement records keyed by source child paths.',
  ),
  /**
   * Whether this instance keeps its own width though its main hugs its content: set
   * when the instance is resized on that axis. Absent or false: it follows the main.
   */
  isWidthFixed: z
    .boolean()
    .optional()
    .describe("Whether it keeps its own width though its main's auto-layout hugs it."),
  /** As `isWidthFixed`, for the height. */
  isHeightFixed: z
    .boolean()
    .optional()
    .describe("Whether it keeps its own height though its main's auto-layout hugs it."),
  /**
   * How much larger its content draws than the main's, from {@link INSTANCE_SCALE_MIN}
   * to {@link INSTANCE_SCALE_MAX}; absent is 1. `width` and `height` stay the drawn box: the
   * content is laid out in a box of `width / scale` by `height / scale` main units, then every
   * length of it, text and strokes included, is drawn `scale` times larger.
   */
  scale: z
    .number()
    .min(INSTANCE_SCALE_MIN)
    .max(INSTANCE_SCALE_MAX)
    .optional()
    .describe('How much larger the content draws than its main, 0.05 to 20; absent is 1.'),
  /** The colour mode of the instance's content; absent for its main's. */
  colorMode: colorModeSchema.optional(),
  /**
   * The value it selects on each of its main's variant axes; an axis it omits, or a
   * value its main no longer lists, takes the axis default, and the choice is kept.
   */
  variant: variantSelectionSchema
    .optional()
    .describe("The value selected on each of its main's variant axes; omit for the defaults."),
  /**
   * The mains this slot may be swapped to, meaningful on an instance inside a main: one
   * to 64 distinct ids. Commands refuse a swap outside the list; no list allows any live main.
   * Reading never checks the ids against the board.
   */
  swapOptions: z
    .array(objectIdSchema)
    .min(1)
    .max(MAX_SWAP_OPTIONS)
    .refine((ids) => new Set(ids).size === ids.length, 'swap options must be distinct')
    .optional()
    .describe('The mains this slot may be swapped to, 1 to 64 distinct ids; omit for any main.'),
});

/** A stored instance placement, size and overrides. */
export type InstanceObject = z.output<typeof instanceObjectSchema>;
