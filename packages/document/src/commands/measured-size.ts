import { z } from 'zod';

/**
 * Validates a text box's measured size: a positive, finite width and height, world units. The
 * size a text or sticky body's text lays out to, written with the change that made it
 * (`setTextRuns`, `setStyle`), so the stored bounds follow the text in one undo step.
 */
export const measuredSizeSchema = z
  .strictObject({
    /** The box width, world units, greater than 0. */
    width: z.number().positive().describe('The box width, world units, greater than 0.'),
    /** The box height, world units, greater than 0. */
    height: z.number().positive().describe('The box height, world units, greater than 0.'),
  })
  .describe('The text laid out: the box width and height it measures, world units.');

/** A text box's measured size, as {@link measuredSizeSchema} validates it. */
export type MeasuredSize = z.output<typeof measuredSizeSchema>;

/**
 * Whether an object type's text is a body with a measured box of its own (a text or sticky),
 * rather than a label inside a shape or connector's box.
 *
 * @param type - The object type.
 * @returns True for a text or sticky.
 */
export function hasMeasuredBody(type: string): boolean {
  return type === 'text' || type === 'sticky';
}
