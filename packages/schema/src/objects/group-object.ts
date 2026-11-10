import { z } from 'zod';

import { layerShape } from '../fields/opacity.js';
import { visibilityShape } from '../fields/visibility.js';

import { baseObjectSchema } from './base-object.js';

/**
 * Validates a group object: a transform node whose children name it as
 * their `parentId`. It has no size fields: a group's bounds are derived from its children and
 * never stored, so a group with `width` or `height` fails validation. Ungrouping is a
 * reparent of the children.
 */
export const groupObjectSchema = baseObjectSchema
  .extend({
    /** Always `'group'`: the discriminator of this object type. */
    type: z.literal('group'),
    /** The layer's opacity from 0 to 1; absent is opaque. */
    ...layerShape,
    ...visibilityShape,
  })
  .describe('A transform node grouping its children; its bounds are derived from them.');

/** A group object. */
export type GroupObject = z.output<typeof groupObjectSchema>;
