import { z } from 'zod';

import { ID_PATTERN } from './object-id.js';

/**
 * Validates a page id: the same pattern as an object id, 1 to 64
 * letters, digits, `_` or `-`, unique within a board. Opaque, like an object id.
 */
export const pageIdSchema = z
  .string()
  .regex(ID_PATTERN, 'a page id is 1 to 64 letters, digits, "_" or "-"')
  .brand<'PageId'>()
  .describe('Opaque page id, unique within the board: 1 to 64 of [A-Za-z0-9_-].');

/** The id of a page of a board. Branded, as an object id is. */
export type PageId = z.output<typeof pageIdSchema>;

/**
 * Tells whether a value is a string a page id may be.
 *
 * @param value - Anything, as a peer may have written it.
 * @returns True for a string matching the id pattern.
 */
export function isPageIdText(value: unknown): value is PageId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
