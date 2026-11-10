import { z } from 'zod';

/**
 * The characters an id may use: letters, digits, `_` and `-`. This covers UUIDs and nanoids,
 * and keeps ids safe as Yjs map keys, URL segments and JSON keys without escaping. Object ids
 * and page ids share it.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates an object id: an opaque string of 1 to 64 letters, digits, `_` or `-`, unique within
 * a board. Nothing may be inferred from an id's content; the generator that makes production ids
 * belongs to the command layer (`@canvas/document`), and tests use `createSeededIdGenerator`.
 */
export const objectIdSchema = z
  .string()
  .regex(ID_PATTERN, 'an id is 1 to 64 letters, digits, "_" or "-"')
  .brand<'ObjectId'>()
  .describe('Opaque object id, unique within the board: 1 to 64 of [A-Za-z0-9_-].');

/**
 * The id of an object on a board. Branded, so a plain string (a vertex
 * id, an asset id, a thread id) cannot be passed where an object id is expected without going
 * through {@link objectIdSchema}.
 */
export type ObjectId = z.output<typeof objectIdSchema>;
