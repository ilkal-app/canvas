import { z } from 'zod';

// The stroke style of pen paths, lines and connectors: a dash pattern, the join at
// corners and the cap at open ends. Each is a sibling of `stroke` in the object's style group,
// not a member of it: `strokeSchema` stays `{ color, width }`, so no stored field changes shape
// and the stored layout does not rise. Absent means today's drawing.

/** How a stroke turns a corner: as SVG's `stroke-linejoin`. */
export const STROKE_JOINS = ['miter', 'round', 'bevel'] as const;

/** How an open stroke, or a dash, ends: as SVG's `stroke-linecap`. */
export const STROKE_CAPS = ['butt', 'round', 'square'] as const;

/** The most entries a dash pattern holds. */
export const MAX_STROKE_DASH_ENTRIES = 8;

/** The longest dash or gap, world px. */
export const MAX_STROKE_DASH_LENGTH = 4096;

/** The furthest a dash pattern is shifted along the stroke, either way, world px. */
export const MAX_STROKE_DASH_OFFSET = MAX_STROKE_DASH_ENTRIES * MAX_STROKE_DASH_LENGTH;

/** The miter limit an absent `strokeMiterLimit` stands for (SVG's initial value). */
export const DEFAULT_STROKE_MITER_LIMIT = 4;

/** The largest miter limit, a ratio of the miter's length to the stroke's width. */
export const MAX_STROKE_MITER_LIMIT = 100;

/**
 * Validates a dash pattern's lengths: 1 to {@link MAX_STROKE_DASH_ENTRIES} finite lengths from 0
 * to {@link MAX_STROKE_DASH_LENGTH} world px, dash first, then gap, and so on; not all zero. An
 * odd count is repeated to make it even, as SVG does (`[4]` is 4 on, 4 off).
 */
export const strokeDashPatternSchema = z
  .array(z.number().min(0).max(MAX_STROKE_DASH_LENGTH))
  .min(1)
  .max(MAX_STROKE_DASH_ENTRIES)
  .refine((pattern) => pattern.some((length) => length > 0), {
    message: 'a dash pattern needs a length above 0',
  })
  .describe(
    'Dash and gap lengths in world px, alternating, dash first: 1 to 8 numbers from 0 to 4096, not all 0; an odd list repeats (4 is 4 on, 4 off). A 0 dash with round or square caps draws a dot.',
  );

/**
 * Validates a stroke's dash pattern: its lengths and how far along the stroke the pattern
 * starts (`offset`, world px, default 0; positive shifts the pattern back along the stroke, as
 * SVG's `stroke-dashoffset`). Each open chain of a path, and a line's shaft, starts it afresh.
 */
export const strokeDashSchema = z
  .strictObject({
    /** Dash and gap lengths, world px. */
    pattern: strokeDashPatternSchema,
    /** Where the pattern starts, world px along the stroke; default 0. */
    offset: z
      .number()
      .min(-MAX_STROKE_DASH_OFFSET)
      .max(MAX_STROKE_DASH_OFFSET)
      .optional()
      .describe('How far into the pattern the stroke starts, world px; default 0.'),
  })
  .describe('A dash pattern: { pattern, offset? }.');

/** A stroke's dash pattern. */
export type StrokeDash = z.output<typeof strokeDashSchema>;

/** Validates a stroke join: one of {@link STROKE_JOINS}. */
export const strokeJoinSchema = z
  .enum(STROKE_JOINS)
  .describe('How the stroke turns corners: miter, round or bevel. Absent draws round joins.');

/** A stroke join. */
export type StrokeJoin = (typeof STROKE_JOINS)[number];

/** Validates a miter limit: from 1 to {@link MAX_STROKE_MITER_LIMIT}. */
export const strokeMiterLimitSchema = z
  .number()
  .min(1)
  .max(MAX_STROKE_MITER_LIMIT)
  .describe(
    'With miter joins: the longest miter, as a multiple of the stroke width, from 1 to 100; a sharper corner is bevelled. Default 4.',
  );

/** Validates a stroke cap: one of {@link STROKE_CAPS}. */
export const strokeCapSchema = z
  .enum(STROKE_CAPS)
  .describe(
    'How open ends and dashes end: butt, round or square. Absent draws round ends. On a line or connector it applies to an end without a decoration (startCap or endCap none).',
  );

/** A stroke cap. */
export type StrokeCap = (typeof STROKE_CAPS)[number];

/**
 * The stroke style fields of a path, line or connector, spread into each schema beside its
 * `stroke`. Each is optional: absent keeps the drawing every earlier build gave it (solid,
 * round joins; round ends on a path, the decoration's shaft end on a line or connector).
 */
export const strokeStyleFields = {
  /** The dash pattern, or null or absent for a solid stroke. */
  strokeDash: strokeDashSchema
    .nullable()
    .optional()
    .describe('The dash pattern: { pattern, offset? }, or null for a solid stroke.'),
  /** How the stroke turns corners; absent is round. */
  strokeJoin: strokeJoinSchema.optional(),
  /** The miter limit of miter joins; absent is 4. */
  strokeMiterLimit: strokeMiterLimitSchema.optional(),
  /** How open ends and dashes end; absent is round. */
  strokeCap: strokeCapSchema.optional(),
};

/** The stroke style of a path, line or connector, as far as it is set. */
export interface StrokeStyle {
  /** The dash pattern; null or absent for solid. */
  readonly strokeDash?: StrokeDash | null | undefined;
  /** The join; absent for round. */
  readonly strokeJoin?: StrokeJoin | undefined;
  /** The miter limit; absent for {@link DEFAULT_STROKE_MITER_LIMIT}. */
  readonly strokeMiterLimit?: number | undefined;
  /** The cap; absent for round. */
  readonly strokeCap?: StrokeCap | undefined;
}
