import { z } from 'zod';

import { linkShape } from '../fields/link.js';
import { layerShape } from '../fields/opacity.js';
import { refineRuns, textContentShape } from '../fields/text-content.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * Horizontal alignment of lines within a text box. `start` and `end` are logical: the side a
 * paragraph's lines begin and end on, left and right for a left-to-right paragraph and the
 * reverse for a right-to-left one.
 */
export const TEXT_ALIGNS = ['left', 'center', 'right', 'start', 'end'] as const;

/**
 * A text box's base direction: `auto` takes each paragraph's from its first strong
 * character (Unicode bidi rules P2 and P3); `ltr` and `rtl` set every paragraph's.
 */
export const TEXT_DIRECTIONS = ['auto', 'ltr', 'rtl'] as const;

/** Vertical placement of the laid-out text within its box. */
export const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const;

/**
 * The text fields shared by text objects and stickies: the prototype's
 * `text` + `runs` model (`src/text/runs.ts`) plus alignment and the auto-width switch.
 */
export const textBoxShape = {
  ...textContentShape,
  /** Horizontal alignment of each line: left, center, right, or the paragraph's start or end. */
  align: z
    .enum(TEXT_ALIGNS)
    .describe(
      "Horizontal alignment of each line: left, center, right, or the paragraph's start or end side.",
    ),
  /** The base direction of each paragraph; absent means auto. */
  direction: z
    .enum(TEXT_DIRECTIONS)
    .optional()
    .describe(
      'Base direction of each paragraph: auto (from its first strong letter, the default), ltr or rtl.',
    ),
  /** When true the box grows with its longest line and wraps only at newlines; when false it wraps at width. */
  autoWidth: z
    .boolean()
    .describe(
      'When true the box grows with its longest line and wraps only at newlines; when false it wraps at width.',
    ),
  /** Vertical placement of the text in the box: top, middle or bottom. */
  verticalAlign: z
    .enum(VERTICAL_ALIGNS)
    .describe('Vertical placement of the text in the box: top, middle or bottom.'),
};

/**
 * Validates a text object: rich text in a box. `width` is the wrapping width when `autoWidth` is
 * false, and the measured width of the longest line when it is true; `height` is always the
 * measured height of the laid-out text, since text grows with its content. Both are stored so
 * that culling, hit testing and agents can use the bounds without laying the text out. The runs
 * obey the invariant of `findRunIssues`.
 */
export const textObjectSchema = baseObjectSchema
  .extend({
    /** Always `'text'`: the discriminator of this object type. */
    type: z.literal('text'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    ...boxShape,
    ...textBoxShape,
    ...linkShape,
  })
  .superRefine(refineRuns)
  .describe('Rich text in a box.');

/** A text object. */
export type TextObject = z.output<typeof textObjectSchema>;
