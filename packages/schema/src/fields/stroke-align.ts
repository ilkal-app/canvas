import { z } from 'zod';

import { strokeSchema } from './stroke.js';

/**
 * Where a shape's or frame's outline lies about its edge, as in the design tools:
 * wholly inside it, straddling it (half inside, half outside, as SVG strokes) or wholly outside
 * it.
 */
export const STROKE_ALIGNS = ['inside', 'center', 'outside'] as const;

/** Where an outline lies about its object's edge: one of {@link STROKE_ALIGNS}. */
export type StrokeAlign = (typeof STROKE_ALIGNS)[number];

/** The alignment an object without `strokeAlign` draws with: inside, as every shape always did. */
export const DEFAULT_STROKE_ALIGN: StrokeAlign = 'inside';

/** Validates a stroke alignment: one of {@link STROKE_ALIGNS}. */
export const strokeAlignSchema = z
  .enum(STROKE_ALIGNS)
  .describe(
    'Where the outline lies about the edge: inside (the default), center (straddling it, as SVG) or outside.',
  );

/**
 * The `strokeAlign` field of a shape or frame: a {@link strokeAlignSchema} value, or
 * absent for {@link DEFAULT_STROKE_ALIGN}. Absent is what every object stored before the field
 * had, so existing outlines draw as before.
 */
export const strokeAlignFieldSchema = strokeAlignSchema
  .optional()
  .describe(
    'Where the outline lies about the edge: inside, center (straddling it, as SVG) or outside. Omit for inside.',
  );

/**
 * A frame's outline: a {@link strokeSchema} value (its colour may be
 * `'ink'`), or `null` or absent for none. Absent is what every frame stored before the
 * field had; `null` is what turning an outline off writes, since a style patch cannot remove a
 * field.
 */
export const frameStrokeFieldSchema = strokeSchema
  .nullable()
  .optional()
  .describe('The outline around the frame { color, width }, or null or absent for none.');

/** The fraction of an outline's width that lies outside the edge, by alignment. */
const OUTSIDE_FRACTION: Readonly<Record<StrokeAlign, number>> = Object.freeze({
  inside: 0,
  center: 0.5,
  outside: 1,
});

/**
 * The fraction of an outline's width that lies outside its object's edge: 0 inside
 * (and for absent, {@link DEFAULT_STROKE_ALIGN}), 0.5 centred, 1 outside. The rest lies inside.
 * A value that is not one of {@link STROKE_ALIGNS} (a stored value that skipped the door) is
 * read as inside. Pure.
 *
 * @param align - The stored alignment, or anything.
 * @returns The fraction, in [0, 1].
 */
export function strokeOutsideFraction(align: unknown): number {
  return align === 'center' || align === 'outside' ? OUTSIDE_FRACTION[align] : 0;
}

/**
 * How far an outline reaches outside its object's edge, world px: its width times
 * {@link strokeOutsideFraction}; 0 for an inside outline or none. Pure.
 *
 * @param stroke - The outline, or `null` or absent for none.
 * @param stroke.width - Its width, world px.
 * @param align - The stored alignment, or anything.
 * @returns The reach, world px, at least 0.
 */
export function strokeOutsetOf(
  stroke: { readonly width: number } | null | undefined,
  align: unknown,
): number {
  if (stroke === null || stroke === undefined || !(stroke.width > 0)) return 0;
  return stroke.width * strokeOutsideFraction(align);
}
