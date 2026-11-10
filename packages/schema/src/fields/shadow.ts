import { z } from 'zod';

import { rgbaSchema } from './color.js';

/** The largest shadow offset on either axis, world px: `x` and `y` lie in [−1000, 1000]. */
export const MAX_SHADOW_OFFSET = 1000;

/** The largest shadow blur radius, world px: `blur` lies in [0, 500]. */
export const MAX_SHADOW_BLUR = 500;

/** The largest shadow spread either way, world px: `spread` lies in [−500, 500]. */
export const MAX_SHADOW_SPREAD = 500;

/**
 * Validates a drop shadow: a blurred copy of the object's silhouette in `color`,
 * moved by `x` and `y`, grown (or shrunk, when negative) by `spread` on every side and blurred
 * with a radius of `blur`, drawn under the object. Lengths are world px, in the object's own
 * frame (the shadow turns with it); `blur` is the design tools' blur radius (Figma's, CSS
 * `box-shadow`'s: a Gaussian whose standard deviation is half of it). The colour is a tuple, never
 * `'ink'`: a shadow darkens what is under it, and ink's light dark-theme colour would make it a
 * glow (ink is kept off fills for the same reason).
 */
export const shadowSchema = z
  .strictObject({
    /** The horizontal offset, world px, in [−1000, 1000]; positive moves right. */
    x: z
      .number()
      .min(-MAX_SHADOW_OFFSET)
      .max(MAX_SHADOW_OFFSET)
      .describe('Horizontal offset in world px, -1000 to 1000; positive moves right.'),
    /** The vertical offset, world px, in [−1000, 1000]; positive moves down. */
    y: z
      .number()
      .min(-MAX_SHADOW_OFFSET)
      .max(MAX_SHADOW_OFFSET)
      .describe('Vertical offset in world px, -1000 to 1000; positive moves down.'),
    /** The blur radius, world px, in [0, 500]; 0 is a sharp edge. */
    blur: z
      .number()
      .min(0)
      .max(MAX_SHADOW_BLUR)
      .describe('Blur radius in world px, 0 to 500 (as in Figma or CSS box-shadow); 0 is sharp.'),
    /** How far the shadow grows past the silhouette on every side, world px, in [−500, 500]. */
    spread: z
      .number()
      .min(-MAX_SHADOW_SPREAD)
      .max(MAX_SHADOW_SPREAD)
      .describe('World px the shadow grows on every side, -500 to 500; negative shrinks it.'),
    /** The shadow's colour, straight alpha; never `'ink'`. */
    color: rgbaSchema,
  })
  .describe(
    'A drop shadow under the object: its silhouette moved by x and y, grown by spread and blurred by blur (world px), in color.',
  );

/** A drop shadow: offset, blur, spread (world px) and colour. */
export type Shadow = z.output<typeof shadowSchema>;

/** The most shadow layers one object or effect style holds. */
export const MAX_SHADOW_LAYERS = 8;

/**
 * Validates a list of shadow layers: 1 to {@link MAX_SHADOW_LAYERS} drop shadows, drawn
 * in order, the first lowest (as an effect style's layers, Figma's two-layer elevation styles).
 */
export const shadowLayersSchema = z
  .array(shadowSchema)
  .min(1)
  .max(MAX_SHADOW_LAYERS)
  .describe('1 to 8 drop shadows, drawn in order, the first lowest.');

/** One shadow, or a list of layers drawn in order. */
export type ShadowValue = Shadow | readonly Shadow[];

/**
 * The shadow field of a shape or frame: a {@link shadowSchema} value, a list of 1 to
 * 8 layers, or `null` or absent for none. Absent is what every object stored before the
 * field had; `null` is what turning a shadow off writes, since a style patch cannot remove a field.
 * A single shadow and a one-layer list draw the same.
 */
export const shadowFieldSchema = z
  .union([shadowSchema, shadowLayersSchema])
  .nullable()
  .optional()
  .describe(
    'A drop shadow under the object, a list of 1 to 8 drawn in order (the first lowest), or null or absent for none.',
  );

/**
 * The layers a shadow field draws, in order: none for `null` or absent, one for a single shadow.
 * Pure; the value is not copied.
 *
 * @param shadow - A shape's or frame's shadow field.
 * @returns The layers, the first drawn lowest.
 */
export function shadowLayersOf(shadow: ShadowValue | null | undefined): readonly Shadow[] {
  if (shadow === null || shadow === undefined) return [];
  return isShadowList(shadow) ? shadow : [shadow];
}

/**
 * Tells a list of shadow layers from a single shadow.
 *
 * @param shadow - A shadow value.
 * @returns True for a list.
 */
function isShadowList(shadow: ShadowValue): shadow is readonly Shadow[] {
  return Array.isArray(shadow);
}

/**
 * The shadow the inspector turns on and an agent may start from: Figma's default drop shadow,
 * 4 px down, a 4 px blur, no spread, black at 25%.
 */
export const DEFAULT_SHADOW: Shadow = Object.freeze({
  x: 0,
  y: 4,
  blur: 4,
  spread: 0,
  color: Object.freeze([0, 0, 0, 0.25]) as unknown as Shadow['color'],
});
