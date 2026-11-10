import { z } from 'zod';

/**
 * Validates a point `{ x, y }` in world units. Which frame the point is in (the parent's, the
 * object's own) is stated by the field that holds it.
 */
export const pointSchema = z.strictObject({
  /** Horizontal coordinate, world units, increasing to the right. */
  x: z.number().describe('Horizontal coordinate, world units, increasing to the right.'),
  /** Vertical coordinate, world units, increasing downwards. */
  y: z.number().describe('Vertical coordinate, world units, increasing downwards.'),
});

/** A point in world units; its frame is stated by the field that holds it. */
export type Point = z.output<typeof pointSchema>;

/**
 * Validates a point in the unit square: `x` and `y` in [0, 1], fractions of a box's width and
 * height measured from its top-left corner. `{ x: 0.5, y: 0.5 }` is the centre.
 */
export const unitPointSchema = z.strictObject({
  /** Fraction of the width from the left edge, 0..1. */
  x: z.number().min(0).max(1).describe('Fraction of the width from the left edge, 0..1.'),
  /** Fraction of the height from the top edge, 0..1. */
  y: z.number().min(0).max(1).describe('Fraction of the height from the top edge, 0..1.'),
});

/** A point in the unit square, as fractions of a box's width and height. */
export type UnitPoint = z.output<typeof unitPointSchema>;
