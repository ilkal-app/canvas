import { z } from 'zod';

import { ID_PATTERN } from '../ids/object-id.js';

// The id of a board's named text or effect style, in a file of its own
// so a run's style (`text-style.ts`) can carry one without importing the style tables.

/** Validates a named style's id: 1 to 64 of `[A-Za-z0-9_-]` (the object id pattern). */
export const styleIdSchema = z
  .string()
  .regex(ID_PATTERN, 'a style id is 1 to 64 letters, digits, "_" or "-"')
  .describe("A named text or effect style's id.");

/** The id of a board's named text or effect style. */
export type StyleId = z.output<typeof styleIdSchema>;

/**
 * The `effectStyleId` field of a shape or frame: the board effect style its shadow
 * layers come from, or absent for none.
 */
export const effectStyleIdFieldSchema = styleIdSchema
  .optional()
  .describe('The board effect style its shadow comes from; absent for none.');
