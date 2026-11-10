import { z } from 'zod';

/** What an opacity field says to a reader: the image's wording, shared by every layer. */
const OPACITY_DESCRIPTION = 'Opacity from 0 (invisible) to 1 (opaque).';

/**
 * Validates an opacity: a number from 0 (invisible) to 1 (opaque). An image's required
 * `opacity` is this schema; a layer's optional one is {@link layerShape}'s.
 */
export const opacitySchema = z.number().min(0).max(1).describe(OPACITY_DESCRIPTION);

/**
 * The layer opacity field that text, stickies, shapes, lines, connectors, paths,
 * groups, frames, mains and instances spread into their schema: an optional
 * {@link opacitySchema}. Absent is opaque (1), what every object stored before the field had,
 * so it draws as before; a style patch removes it by writing `undefined`. A container's opacity
 * multiplies into everything under it. Images keep their own required `opacity`; comments and
 * videos take none.
 */
export const layerShape = {
  /** The layer's opacity from 0 to 1; absent is opaque. */
  opacity: opacitySchema.optional().describe(OPACITY_DESCRIPTION),
};

/**
 * The object types that store an optional layer `opacity` ({@link layerShape}). An image
 * stores a required one of its own; a comment and a video store none.
 */
export const LAYER_OPACITY_TYPES = [
  'text',
  'sticky',
  'shape',
  'line',
  'connector',
  'path',
  'freehand',
  'group',
  'frame',
  'component',
  'instance',
  'link',
] as const;

/**
 * A stored layer opacity as a number in [0, 1]: absent, and anything the schema refuses
 * (a stored value that skipped the door), is opaque. Pure.
 *
 * @param value - The stored `opacity`, or anything.
 * @returns The opacity to draw with.
 */
export function layerOpacityOf(value: unknown): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : 1;
}
