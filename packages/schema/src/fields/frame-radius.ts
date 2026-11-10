import { z } from 'zod';

/** One corner's rounding, world px: at least 0 (the limit on every way in is `BOARD_BOUND`). */
const cornerSchema = z.number().nonnegative();

/**
 * Four corners' rounding, typed as a readonly tuple so a caller's `as const` radii are accepted.
 * Not zod's `.readonly()`, which would advertise the field as `readOnly` in the JSON Schema
 * agents read (a field a client may not write); the parsed tuple is a fresh array either way.
 */
const cornersSchema = z.tuple([
  cornerSchema,
  cornerSchema,
  cornerSchema,
  cornerSchema,
]) as unknown as z.ZodType<readonly [number, number, number, number]>;

/**
 * Validates a frame's corner rounding: one radius for all four corners, or four in
 * Figma's order, `[topLeft, topRight, bottomRight, bottomLeft]`, each at least 0, world px. When
 * drawn, each is capped at half the frame's shorter side (the engine's `drawnFrameCornerRadii`).
 */
export const frameCornerRadiusSchema = z
  .union([cornerSchema, cornersSchema])
  .describe(
    'Corner rounding in world px: one number for all four corners, or [topLeft, topRight, bottomRight, bottomLeft]; 0 is sharp.',
  );

/** A frame's corner rounding: one radius, or four from the top-left corner clockwise. */
export type FrameCornerRadius = z.output<typeof frameCornerRadiusSchema>;

/** Four corner radii, world px, from the top-left corner clockwise. */
export type CornerRadii = readonly [number, number, number, number];

/**
 * The `cornerRadius` field of a frame: a {@link frameCornerRadiusSchema} value, or
 * absent for sharp corners. Absent is what every frame stored before the field had, so it draws
 * as before. A style patch removes it by writing `undefined`.
 */
export const frameCornerRadiusFieldSchema = frameCornerRadiusSchema
  .optional()
  .describe(
    'Corner rounding in world px: one number, or [topLeft, topRight, bottomRight, bottomLeft]. Omit for sharp corners.',
  );

/** Sharp corners: what an absent or unreadable radius reads as. */
const SHARP_CORNERS: CornerRadii = Object.freeze([0, 0, 0, 0]) as unknown as CornerRadii;

/**
 * Whether a value is one corner's radius as the schema accepts it: a finite number at least 0.
 *
 * @param value - Anything.
 * @returns True for an acceptable radius.
 */
function isCorner(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * A stored frame radius as four corner radii, from the top-left clockwise: a number is
 * every corner's; absent, and anything the schema refuses (a stored value that skipped the door),
 * is sharp. Not capped (the engine caps each at half the shorter side). Pure.
 *
 * @param value - The stored `cornerRadius`, or anything.
 * @returns The four radii.
 */
export function frameCornerRadii(value: unknown): CornerRadii {
  if (isCorner(value)) return [value, value, value, value];
  if (Array.isArray(value) && value.length === 4 && value.every(isCorner)) {
    return [value[0], value[1], value[2], value[3]] as CornerRadii;
  }
  return SHARP_CORNERS;
}
