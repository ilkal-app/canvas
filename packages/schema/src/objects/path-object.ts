import { z } from 'zod';

import { layerShape } from '../fields/opacity.js';
import { isImagePaint, paintSchema } from '../fields/paint.js';
import { strokeStyleFields } from '../fields/stroke-style.js';
import { strokeSchema } from '../fields/stroke.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema } from './base-object.js';
import { findNetworkIssues, segmentSchema, vertexSchema } from './path-network.js';

/**
 * Validates a path object: a vector network from the pen tool, the
 * prototype's `VectorObject` (`src/vector/model.ts`). Vertices are in the path's own frame; its
 * bounds are derived from them. The network must be well formed (`findNetworkIssues`).
 */
export const pathObjectSchema = baseObjectSchema
  .extend({
    /** Always `'path'`: the discriminator of this object type. */
    type: z.literal('path'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    /** The vertices of the vector network. */
    vertices: z.array(vertexSchema).describe('The vertices of the vector network.'),
    /** The cubic segments joining pairs of vertices. */
    segments: z.array(segmentSchema).describe('The cubic segments joining pairs of vertices.'),
    /** The outline, or null for none. */
    stroke: strokeSchema.nullable().describe('The outline, or null for none.'),
    ...strokeStyleFields,
    /** The even-odd fill of closed regions: a colour or a gradient, or null for none. */
    fill: paintSchema
      .refine((paint) => !isImagePaint(paint), {
        message: 'An image paint is for a shape fill or a frame background only.',
      })
      .nullable()
      .describe('The even-odd fill of closed regions: a colour or a gradient, or null for none.'),
  })
  .superRefine((path, context) => {
    for (const message of findNetworkIssues(path.vertices, path.segments)) {
      context.addIssue({ code: 'custom', path: ['segments'], message, input: path.segments });
    }
  })
  .describe('A vector network drawn with the pen tool.');

/** A path object. */
export type PathObject = z.output<typeof pathObjectSchema>;
