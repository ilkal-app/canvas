import { z } from 'zod';

import { inkableColorSchema } from './color.js';

/** The widest stroke, in world px (the prototype's limit, `src/vector/model.ts`). */
export const MAX_STROKE_WIDTH = 64;

/**
 * Validates a stroke: a colour (a tuple or `'ink'`) and a width in world px, `0 < width <= 64`
 * ({@link MAX_STROKE_WIDTH}). Objects that may have no outline hold `stroke: null`.
 */
export const strokeSchema = z.strictObject({
  /** The stroke colour: a tuple, or `'ink'` for the viewer's theme ink. */
  color: inkableColorSchema,
  /** Stroke width in world px, greater than 0 and at most 64. */
  width: z
    .number()
    .positive()
    .max(MAX_STROKE_WIDTH)
    .describe('Stroke width in world px, greater than 0 and at most 64.'),
});

/** A stroke: colour and width in world px. */
export type Stroke = z.output<typeof strokeSchema>;
