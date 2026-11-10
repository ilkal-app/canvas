import { z } from 'zod';

import { lineCapSchema } from '../fields/line-cap.js';
import { layerShape } from '../fields/opacity.js';
import { pointSchema } from '../fields/point.js';
import { strokeStyleFields } from '../fields/stroke-style.js';
import { strokeSchema } from '../fields/stroke.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema } from './base-object.js';

/** How a line runs between its two points: directly, or in axis-aligned elbow segments. */
export const LINE_ROUTES = ['straight', 'elbow'] as const;

/**
 * Validates a line object: a stroke between two free points in the
 * line's own frame, straight or elbowed, with a cap at each end. A line attached to objects is a
 * connector instead.
 */
export const lineObjectSchema = baseObjectSchema
  .extend({
    /** Always `'line'`: the discriminator of this object type. */
    type: z.literal('line'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    /** The start and end points, in the line's own frame. */
    points: z
      .tuple([pointSchema, pointSchema])
      .describe("The start and end points, in the line's own frame."),
    /** straight, or elbow for axis-aligned segments. */
    route: z.enum(LINE_ROUTES).describe('straight, or elbow for axis-aligned segments.'),
    /** The colour and width of the line. */
    stroke: strokeSchema,
    ...strokeStyleFields,
    /** The decoration at the first point. */
    startCap: lineCapSchema,
    /** The decoration at the second point. */
    endCap: lineCapSchema,
  })
  .describe('A straight or elbow line between two free points.');

/** A line object. */
export type LineObject = z.output<typeof lineObjectSchema>;
