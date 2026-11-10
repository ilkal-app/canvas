import { z } from 'zod';

import { tokenEntrySchema } from '../fields/color-tokens.js';
import { effectStyleEntrySchema, textStyleEntrySchema } from '../fields/named-styles.js';
import { boardObjectSchema } from '../objects/board-object.js';
import { pageSchema } from '../pages/page.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

/** The `format` tag of a portable board document, which never changes between versions. */
export const PORTABLE_BOARD_FORMAT = 'canvas.board';

/**
 * Validates one colour token of a portable document: its id, name, identity (as the
 * stored `<id>.identity` key: built-in or not, who created it and when; optional on import) and
 * two values. A built-in's entry is told by its id (`BUILTIN_TOKENS`), whatever `builtin` says.
 */
export const portableTokenSchema = z.strictObject({
  ...tokenEntrySchema.pick({ id: true, name: true }).shape,
  /** Whether the token is a built-in, who created it and when; absent when unknown. */
  identity: tokenEntrySchema
    .pick({ builtin: true, createdBy: true, createdAt: true })
    .strict()
    .optional()
    .describe('Whether the token is a built-in, who created it and when; absent if unknown.'),
  ...tokenEntrySchema.pick({ light: true, dark: true }).shape,
});

/** One colour token of a portable document. */
export type PortableToken = z.output<typeof portableTokenSchema>;

/**
 * Validates a portable board document at the current schema version: plain JSON holding the
 * format tag, the schema version, the board's pages (absent: the default page alone)
 * and every object of the board. It is independent of the live Yjs representation, so a board
 * can be saved as a file, sent to an agent or moved between deployments. Older documents are
 * migrated before this schema applies; references are checked by `validateBoard`.
 */
export const portableBoardSchema = z.strictObject({
  /** Always "canvas.board". */
  format: z.literal(PORTABLE_BOARD_FORMAT).describe('Always "canvas.board".'),
  /** The schema version the objects are written in. */
  schemaVersion: z
    .literal(SCHEMA_VERSION)
    .describe('The schema version the objects are written in.'),
  /** The board's pages, in page order (by `order`, then id); absent for the default page only. */
  pages: z
    .array(pageSchema)
    .optional()
    .describe("The board's pages in order; absent for one default page."),
  /**
   * The board's colour token table: its custom tokens and edited built-ins, sorted by
   * id; absent for the built-ins at their defaults alone.
   */
  tokens: z
    .array(portableTokenSchema)
    .optional()
    .describe("The board's custom colour tokens and edited built-ins; absent for none."),
  /** The board's named text styles, sorted by id; absent for none. */
  textStyles: z
    .array(textStyleEntrySchema)
    .optional()
    .describe("The board's named text styles; absent for none."),
  /** The board's named effect styles, sorted by id; absent for none. */
  effectStyles: z
    .array(effectStyleEntrySchema)
    .optional()
    .describe("The board's named effect styles; absent for none."),
  /** Every object on the board, sorted by id. */
  objects: z.array(boardObjectSchema).describe('Every object on the board, sorted by id.'),
});

/** A portable board document: plain JSON, ready for `JSON.stringify`. */
export type PortableBoardJson = z.output<typeof portableBoardSchema>;
