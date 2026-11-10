import { z } from 'zod';

import { autoLayoutSchema } from '../fields/auto-layout.js';
import { colorModeSchema } from '../fields/color-tokens.js';
import { frameCornerRadiusFieldSchema } from '../fields/frame-radius.js';
import { layerShape } from '../fields/opacity.js';
import { paintSchema } from '../fields/paint.js';
import { shadowFieldSchema } from '../fields/shadow.js';
import { frameStrokeFieldSchema, strokeAlignFieldSchema } from '../fields/stroke-align.js';
import { effectStyleIdFieldSchema } from '../fields/style-id.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema, boxShape } from './base-object.js';

/**
 * Validates a frame object: a named region whose children name it as
 * their `parentId`, with stored bounds, optional clipping and an optional background.
 * Frames are the unit of export and, later, of subdocument splitting.
 */
export const frameObjectSchema = baseObjectSchema
  .extend({
    /** Always `'frame'`: the discriminator of this object type. */
    type: z.literal('frame'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
    ...boxShape,
    /** The frame name shown above it, up to 200 characters. */
    name: z.string().max(200).describe('The frame name shown above it, up to 200 characters.'),
    /** Whether children are clipped to the frame box. */
    clip: z.boolean().describe('Whether children are clipped to the frame box.'),
    /** The fill behind the children: a colour or a gradient, or null for none. */
    background: paintSchema
      .nullable()
      .describe('The fill behind the children: a colour or a gradient, or null for none.'),
    /** The colour mode of the frame's content; absent to inherit. */
    colorMode: colorModeSchema.optional(),
    /**
     * Whether the name is drawn above the frame. Absent means the default
     * (`isFrameNameShown`): hidden on a frame inside another frame or a component (through any
     * groups), shown otherwise.
     */
    showName: z
      .boolean()
      .optional()
      .describe(
        'Whether the name is drawn above the frame. Omit for the default: hidden on a frame inside another frame or a component (through any groups), shown otherwise, as on a root frame.',
      ),
    /** Its live auto-layout; absent for a frame whose children keep their places. */
    autoLayout: autoLayoutSchema
      .optional()
      .describe('Its live auto-layout; omit for a frame whose children keep their places.'),
    /**
     * A drop shadow under the frame's background, or null or absent for none. The
     * frame's own clip never cuts it (`clip` applies to descendants only).
     */
    shadow: shadowFieldSchema,
    /**
     * The board effect style its shadow comes from; absent for none. The
     * layers are stored in `shadow` beside it.
     */
    effectStyleId: effectStyleIdFieldSchema,
    /**
     * The outline around the frame, or null or absent for none. It draws over the
     * frame's background and its children, as in Figma, and the frame's own clip never cuts it
     * (`clip` applies to descendants only).
     */
    stroke: frameStrokeFieldSchema,
    /**
     * Where the frame's outline lies about its edge: inside, centred or outside;
     * absent is inside.
     */
    strokeAlign: strokeAlignFieldSchema,
    /**
     * The frame's corner rounding: one radius, or four from the top-left corner
     * clockwise, world px; absent is sharp. Its background, outline, shadow, hit area and clip
     * follow it; when drawn each radius is capped at half the shorter side.
     */
    cornerRadius: frameCornerRadiusFieldSchema,
  })
  .describe('A named region holding children, with optional clipping.');

/** A frame object. */
export type FrameObject = z.output<typeof frameObjectSchema>;
