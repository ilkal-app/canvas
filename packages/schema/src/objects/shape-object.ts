import { z } from 'zod';

import { layerShape } from '../fields/opacity.js';
import { paintSchema } from '../fields/paint.js';
import { shadowFieldSchema } from '../fields/shadow.js';
import { strokeAlignFieldSchema } from '../fields/stroke-align.js';
import { strokeSchema } from '../fields/stroke.js';
import { effectStyleIdFieldSchema } from '../fields/style-id.js';
import { textContentSchema } from '../fields/text-content.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * The primitive shapes. A rounded rectangle is a `rectangle`
 * with a `cornerRadius`; a triangle is a `polygon` with three sides.
 */
export const SHAPE_KINDS = ['rectangle', 'ellipse', 'diamond', 'polygon', 'star'] as const;

/** The most sides a polygon, or points a star, may have. */
export const MAX_SHAPE_SIDES = 64;

/**
 * Validates a shape object: an SDF-rendered primitive inscribed in its
 * box, with an optional outline, fill and text label drawn inside it.
 */
export const shapeObjectSchema = baseObjectSchema
  .extend({
    /** Always `'shape'`: the discriminator of this object type. */
    type: z.literal('shape'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    ...boxShape,
    /** Which primitive: rectangle, ellipse, diamond, polygon or star. */
    kind: z
      .enum(SHAPE_KINDS)
      .describe('Which primitive: rectangle, ellipse, diamond, polygon or star.'),
    /** The outline, or null for none. */
    stroke: strokeSchema.nullable().describe('The outline, or null for none.'),
    /** The fill: a colour or a gradient, or null for none. */
    fill: paintSchema.nullable().describe('The fill: a colour or a gradient, or null for none.'),
    /** Corner rounding in world units; 0 is sharp. */
    cornerRadius: z.number().nonnegative().describe('Corner rounding in world units; 0 is sharp.'),
    /** Sides of a polygon or points of a star, 3 to 64; ignored by other kinds. */
    sides: z
      .number()
      .int()
      .min(3)
      .max(MAX_SHAPE_SIDES)
      .describe('Sides of a polygon or points of a star, 3 to 64; ignored by other kinds.'),
    /** Text drawn inside the shape, or null for none. */
    label: textContentSchema.nullable().describe('Text drawn inside the shape, or null for none.'),
    /** A drop shadow under the shape, or null or absent for none. */
    shadow: shadowFieldSchema,
    /**
     * The board effect style its shadow comes from; absent for none. The
     * layers are stored in `shadow` beside it.
     */
    effectStyleId: effectStyleIdFieldSchema,
    /**
     * Where the outline lies about the shape's edge: inside, centred or outside;
     * absent is inside, as every shape drew before.
     */
    strokeAlign: strokeAlignFieldSchema,
  })
  .describe('A primitive shape with optional outline, fill and text.');

/** A shape object. */
export type ShapeObject = z.output<typeof shapeObjectSchema>;
