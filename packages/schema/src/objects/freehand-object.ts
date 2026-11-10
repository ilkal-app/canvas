import { z } from 'zod';

import { layerShape } from '../fields/opacity.js';
import { strokeSchema } from '../fields/stroke.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema } from './base-object.js';

/** The looks of a freehand stroke: the draw tool's pencil, marker and highlighter. */
export const FREEHAND_TOOLS = ['pencil', 'marker', 'highlighter'] as const;

/** One of the {@link FREEHAND_TOOLS}. */
export type FreehandTool = (typeof FREEHAND_TOOLS)[number];

/**
 * The most points one freehand stroke stores. A longer stroke is split into several
 * objects (`splitFreehand`), so one object's stored value and the work of drawing it stay small.
 */
export const MAX_FREEHAND_POINTS = 1024;

/**
 * The issues of a stroke's point data, judged together: an even count of numbers, 1 to
 * {@link MAX_FREEHAND_POINTS} points, and, when there are pressures, one per point.
 *
 * @param points - The flat x, y pairs.
 * @param pressures - The pressures, or `undefined` for none.
 * @returns A message per issue; empty when the data is well formed.
 */
export function findFreehandIssues(
  points: readonly number[],
  pressures: readonly number[] | undefined,
): string[] {
  const issues: string[] = [];
  if (points.length % 2 !== 0) issues.push('points holds x, y pairs: an even count of numbers.');
  const count = Math.floor(points.length / 2);
  if (count < 1 || count > MAX_FREEHAND_POINTS) {
    issues.push(
      `A stroke has 1 to ${String(MAX_FREEHAND_POINTS)} points; this one has ${String(count)}.`,
    );
  }
  if (pressures !== undefined && pressures.length !== count) {
    issues.push(
      `pressures holds one value per point: ${String(count)}, not ${String(pressures.length)}.`,
    );
  }
  return issues;
}

/**
 * Validates a freehand object: a stroke drawn with the draw tool. Its points are the
 * simplified samples of the gesture, in the object's own frame; the smooth curve through them is
 * computed on read (`freehandCurve`), and its bounds are derived from it. The highlighter's
 * translucency is the layer `opacity`.
 */
export const freehandObjectSchema = baseObjectSchema
  .extend({
    /** Always `'freehand'`: the discriminator of this object type. */
    type: z.literal('freehand'),
    /** The layer's opacity from 0 to 1; absent is opaque. A highlighter is created translucent. */
    ...layerShape,
    ...visibilityShape,
    /** The look: pencil, marker or highlighter. */
    tool: z.enum(FREEHAND_TOOLS).describe('The look: pencil, marker or highlighter.'),
    /** The stroke's points as flat x, y pairs in the object's own frame, world units. */
    points: z
      .array(z.number())
      .describe(
        `The stroke's points as flat x, y pairs in the object's own frame: 1 to ${String(MAX_FREEHAND_POINTS)} points.`,
      ),
    /** The pen pressure at each point, 0 to 1; absent for a stroke of constant width. */
    pressures: z
      .array(z.number().min(0).max(1))
      .optional()
      .describe('The pen pressure at each point, 0 to 1; absent for a stroke of constant width.'),
    /** The colour, and the width at full pressure in world px. */
    stroke: strokeSchema.describe('The colour, and the width at full pressure in world px.'),
  })
  .superRefine((freehand, context) => {
    for (const message of findFreehandIssues(freehand.points, freehand.pressures)) {
      context.addIssue({ code: 'custom', path: ['points'], message, input: freehand.points });
    }
  })
  .describe('A freehand stroke drawn with the draw tool.');

/** A freehand object. */
export type FreehandObject = z.output<typeof freehandObjectSchema>;
