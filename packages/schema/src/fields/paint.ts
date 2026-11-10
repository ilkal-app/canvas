import { z } from 'zod';

import { resolveColor, type ColorMode, type TokenTable } from './color-tokens.js';
import { rgbaSchema, type Rgba } from './color.js';
import { imagePaintSchema, isImagePaint, type ImagePaint } from './image-paint.js';
import { isTokenRef, tokenRefSchema, type TokenRef } from './token-ref.js';

export { imageFitSchema, imagePaintSchema, isImagePaint } from './image-paint.js';
export type { ImageFit, ImagePaint } from './image-paint.js';

// Paint: a solid fill stays the bare `Rgba` tuple it always was, and
// a gradient is an object tagged by `type`, so every fill already stored is a valid paint and
// nothing stored is rewritten. A gradient is evaluated in the object's unit box; `paintColorAt`
// is the one statement of the formulas, which the engine's shaders, the PNG projection, the
// default-colour rule and the tests share.

/** The fewest stops a gradient has. */
export const MIN_GRADIENT_STOPS = 2;

/** The most stops a gradient has: the engine's paint table holds eight per record. */
export const MAX_GRADIENT_STOPS = 8;

/** The largest radial radius, in unit-box units. */
export const MAX_RADIAL_RADIUS = 2;

/** Validates one gradient stop: its offset along the gradient in [0, 1], and its colour. */
export const gradientStopSchema = z.strictObject({
  /** Position along the gradient, 0 to 1. */
  offset: z.number().min(0).max(1).describe('Position along the gradient, 0 to 1.'),
  /** The stop's colour, straight alpha; never `ink`. */
  color: rgbaSchema,
});

/** One gradient stop. */
export type GradientStop = z.output<typeof gradientStopSchema>;

/**
 * Validates a gradient's stops: 2 to 8, offsets non-decreasing (equal neighbours make a hard
 * edge).
 */
export const gradientStopsSchema = z
  .array(gradientStopSchema)
  .min(MIN_GRADIENT_STOPS)
  .max(MAX_GRADIENT_STOPS)
  .refine(
    (stops) =>
      stops.every((stop, index) => index === 0 || stop.offset >= (stops[index - 1]?.offset ?? 0)),
    { message: 'Stop offsets must not decrease' },
  )
  .describe('2 to 8 stops with non-decreasing offsets; equal neighbours make a hard edge.');

/**
 * Validates a linear gradient: an angle in radians in (−π, π] (0 points along +x, positive
 * turns clockwise on screen, as `rotation`), and its stops spanning the unit box at that angle.
 */
export const linearGradientSchema = z.strictObject({
  /** Always `'linear'`. */
  type: z.literal('linear'),
  /** Direction in radians, greater than −π and at most π. */
  angle: z
    .number()
    .gt(-Math.PI)
    .lte(Math.PI)
    .describe('Direction in radians, greater than -pi and at most pi; 0 points along +x.'),
  /** The stops. */
  stops: gradientStopsSchema,
});

/** A linear gradient. */
export type LinearGradient = z.output<typeof linearGradientSchema>;

/**
 * Validates a radial gradient: a centre in the unit box and a radius in (0, 2] unit-box units.
 * In a non-square box the circle is an ellipse in the object's frame.
 */
export const radialGradientSchema = z.strictObject({
  /** Always `'radial'`. */
  type: z.literal('radial'),
  /** The centre, as fractions of the box. */
  center: z
    .strictObject({
      /** Across the box from its left edge, 0 to 1. */
      x: z.number().min(0).max(1),
      /** Down the box from its top edge, 0 to 1. */
      y: z.number().min(0).max(1),
    })
    .describe('The centre as fractions of the box, each 0 to 1.'),
  /** The radius in unit-box units, greater than 0 and at most 2. */
  radius: z
    .number()
    .gt(0)
    .lte(MAX_RADIAL_RADIUS)
    .describe('The radius as a fraction of the box, greater than 0 and at most 2.'),
  /** The stops. */
  stops: gradientStopsSchema,
});

/** A radial gradient. */
export type RadialGradient = z.output<typeof radialGradientSchema>;

/** Validates a gradient: linear or radial. */
export const gradientSchema = z.discriminatedUnion('type', [
  linearGradientSchema,
  radialGradientSchema,
]);

/** A linear or radial gradient. */
export type Gradient = LinearGradient | RadialGradient;

/**
 * Validates a paint: a solid colour tuple, a board colour token `{ token }` (decision
 * 0006; never `'ink'`), a linear or radial gradient, or an image.
 * The branches differ by shape: an array, an object with `token`, an object with `type`.
 */
export const paintSchema = z
  .union(
    [rgbaSchema, tokenRefSchema, linearGradientSchema, radialGradientSchema, imagePaintSchema],
    {
      error:
        'Invalid input: expected a colour [r, g, b, a], a token { token }, a linear or radial gradient, or an image',
    },
  )
  .describe(
    "A solid colour [r, g, b, a] in 0..1, a board colour token { token: id }, a gradient { type: 'linear', angle, stops } or { type: 'radial', center, radius, stops }, or an image { type: 'image', assetId, naturalSize, fit, crop }.",
  );

/** A paint as stored: a solid colour, a token reference, a gradient or an image. */
export type Paint = Rgba | TokenRef | Gradient | ImagePaint;

/** A paint as drawn: its token resolved (`resolvePaint`), so a colour, a gradient or an image. */
export type ResolvedPaint = Rgba | Gradient | ImagePaint;

/** A drawn paint that is not an image: what has a colour at every point without an asset. */
export type ColorOrGradient = Rgba | Gradient;

/**
 * Tells whether a paint is a gradient: an object whose `type` is `linear` or `radial`. Keyed on
 * `type`, so a token reference, an image paint, or any other object paint, is not one.
 *
 * @param paint - A paint, or null.
 * @returns True for a gradient object.
 */
export function isGradient(paint: Paint | null): paint is Gradient {
  return (
    paint !== null &&
    !Array.isArray(paint) &&
    ((paint as { type?: unknown }).type === 'linear' ||
      (paint as { type?: unknown }).type === 'radial')
  );
}

/**
 * Resolves a stored paint for drawing: a token reference becomes its value in
 * the mode (`resolveColor`); a tuple, a gradient and an image stay. Pure.
 *
 * @param paint - The stored paint.
 * @param mode - The object's effective colour mode.
 * @param table - The board's token table; absent for the built-in defaults alone.
 * @returns The paint to draw.
 */
export function resolvePaint(paint: Paint, mode: ColorMode, table?: TokenTable): ResolvedPaint {
  return isTokenRef(paint) ? resolveColor(paint, mode, table) : paint;
}

/** `t` is snapped to this grid, so corners and midpoints land exactly. */
const T_GRID = 2 ** 32;

/**
 * Where a unit-box point lies along a gradient, before padding: linear projects onto the
 * direction so the stops span the box at every angle, radial is the distance from the centre in
 * radii.
 *
 * @param gradient - The gradient.
 * @param u - The point's x as a fraction of the box.
 * @param v - The point's y as a fraction of the box.
 * @returns The position along the gradient.
 */
export function gradientPositionAt(gradient: Gradient, u: number, v: number): number {
  let t: number;
  if (gradient.type === 'linear') {
    const dx = Math.cos(gradient.angle);
    const dy = Math.sin(gradient.angle);
    t = 0.5 + ((u - 0.5) * dx + (v - 0.5) * dy) / (Math.abs(dx) + Math.abs(dy));
  } else {
    t = Math.hypot(u - gradient.center.x, v - gradient.center.y) / gradient.radius;
  }
  return Math.round(t * T_GRID) / T_GRID;
}

/** One gradient stop as the evaluator reads it. */
interface Stop {
  readonly offset: number;
  readonly color: Rgba;
}

/**
 * Premultiplies a straight-alpha colour.
 *
 * @param color - `[r, g, b, a]`.
 * @returns `[r·a, g·a, b·a, a]`.
 */
function premultiply(color: Rgba): Rgba {
  const [r, g, b, a] = color;
  return [r * a, g * a, b * a, a];
}

/**
 * Interpolates two premultiplied colours; the ends are returned exactly.
 *
 * @param from - The colour at 0.
 * @param to - The colour at 1.
 * @param f - Where between them, 0 to 1.
 * @returns The colour.
 */
function mix(from: Rgba, to: Rgba, f: number): Rgba {
  if (f <= 0) return from;
  if (f >= 1) return to;
  const at = (a: number, b: number) => a * (1 - f) + b * f;
  return [at(from[0], to[0]), at(from[1], to[1]), at(from[2], to[2]), at(from[3], to[3])];
}

/**
 * The premultiplied colour of a gradient at a position along it: padded beyond the first and last
 * offsets, interpolated linearly in premultiplied sRGB between neighbouring stops, and at equal
 * offsets the later stop from that offset on.
 *
 * @param stops - The stops, at least one, offsets non-decreasing.
 * @param t - The position.
 * @returns `[r·a, g·a, b·a, a]`.
 */
function premultipliedAt(stops: readonly Stop[], t: number): Rgba {
  let before: Stop | undefined;
  for (const stop of stops) {
    if (stop.offset > t) {
      if (before === undefined) return premultiply(stop.color);
      const f = (t - before.offset) / (stop.offset - before.offset);
      return mix(premultiply(before.color), premultiply(stop.color), f);
    }
    before = stop;
  }
  return before === undefined ? [0, 0, 0, 0] : premultiply(before.color);
}

/**
 * Turns a premultiplied colour back into straight alpha; fully transparent is transparent black.
 *
 * @param color - `[r·a, g·a, b·a, a]`.
 * @returns The straight-alpha colour.
 */
function unpremultiply(color: Rgba): Rgba {
  const [r, g, b, a] = color;
  if (a <= 0) return [0, 0, 0, 0];
  const channel = (value: number) => Math.min(1, Math.max(0, value / a));
  return [channel(r), channel(g), channel(b), a];
}

/**
 * The colour of a paint at a point of the object's unit box: `u` across the
 * box from its left edge, `v` down from its top. A solid paint is its colour everywhere. Pure.
 *
 * @param paint - The paint.
 * @param u - The point's x as a fraction of the box.
 * @param v - The point's y as a fraction of the box.
 * @returns The straight-alpha colour there; `null` for an image paint, whose colour is not
 *   known without its pixels, and for a token reference, whose colour is not known
 *   until it is resolved (`resolvePaint`).
 */
export function paintColorAt(paint: ColorOrGradient, u: number, v: number): Rgba;
export function paintColorAt(paint: Paint, u: number, v: number): Rgba | null;
/**
 * The implementation of the overloads above.
 *
 * @param paint - The paint.
 * @param u - The point's x as a fraction of the box.
 * @param v - The point's y as a fraction of the box.
 * @returns The colour, or `null` for an image paint.
 */
export function paintColorAt(paint: Paint, u: number, v: number): Rgba | null {
  if (isImagePaint(paint) || isTokenRef(paint)) return null;
  if (!isGradient(paint)) return paint;
  return unpremultiply(premultipliedAt(paint.stops, gradientPositionAt(paint, u, v)));
}

/**
 * The average colour of a paint over [0, 1] (level of detail): the stops'
 * premultiplied colour integrated along the gradient, padded at both ends. A solid paint is its
 * colour.
 *
 * @param paint - The paint.
 * @returns The straight-alpha average; `null` for an image paint or an unresolved
 *   token reference.
 */
export function paintAverageColor(paint: ColorOrGradient): Rgba;
export function paintAverageColor(paint: Paint): Rgba | null;
/**
 * The implementation of the overloads above.
 *
 * @param paint - The paint.
 * @returns The colour, or `null` for an image paint.
 */
export function paintAverageColor(paint: Paint): Rgba | null {
  if (isImagePaint(paint) || isTokenRef(paint)) return null;
  if (!isGradient(paint)) return paint;
  const sum: Rgba = [0, 0, 0, 0];
  const add = (color: Rgba, weight: number) => {
    const [r, g, b, a] = premultiply(color);
    sum[0] += r * weight;
    sum[1] += g * weight;
    sum[2] += b * weight;
    sum[3] += a * weight;
  };
  let before: Stop | undefined;
  for (const stop of paint.stops) {
    if (before === undefined) add(stop.color, Math.max(0, stop.offset));
    else {
      const half = (stop.offset - before.offset) / 2;
      add(before.color, half);
      add(stop.color, half);
    }
    before = stop;
  }
  if (before !== undefined) add(before.color, Math.max(0, 1 - before.offset));
  return unpremultiply(sum);
}

/**
 * Tells whether any part of a paint is visible: a solid with alpha above 0, or a gradient with any
 * stop's alpha above 0. A token reference counts as visible: its value is the
 * board's, which `resolvePaint` reads.
 *
 * @param paint - The paint, or null.
 * @returns True when something is painted.
 */
export function isPaintVisible(paint: Paint | null): boolean {
  if (paint === null) return false;
  if (isImagePaint(paint)) return true;
  if (isTokenRef(paint)) return true;
  if (!isGradient(paint)) return paint[3] > 0;
  return paint.stops.some((stop) => stop.color[3] > 0);
}

/**
 * Tells whether a paint is opaque everywhere: a solid with alpha 1, or a gradient whose every
 * stop is opaque (only then does it hide what is beneath it). A token reference
 * is not known to be opaque until resolved (`resolvePaint`), so it is not.
 *
 * @param paint - The paint, or null.
 * @returns True when opaque everywhere.
 */
export function isPaintOpaque(paint: Paint | null): boolean {
  if (paint === null || isTokenRef(paint)) return false;
  // An image may have transparent pixels: it never hides what is beneath it for certain.
  if (isImagePaint(paint)) return false;
  if (!isGradient(paint)) return paint[3] >= 1;
  return paint.stops.every((stop) => stop.color[3] >= 1);
}
