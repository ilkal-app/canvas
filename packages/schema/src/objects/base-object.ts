import { z } from 'zod';

import { layoutChildSchema } from '../fields/auto-layout.js';
import { constraintsSchema } from '../fields/constraints.js';
import { objectIdSchema } from '../ids/object-id.js';
import { pageIdSchema } from '../ids/page-id.js';
import { principalIdSchema } from '../ids/principal-id.js';
import { zKeySchema } from '../z-order/z-key-schema.js';

import { objectTypeSchema } from './object-type.js';

/** The longest layer name, in UTF-16 code units; a frame's or main's name too. */
export const MAX_OBJECT_NAME_LENGTH = 200;

/** A timestamp: whole milliseconds since the Unix epoch, UTC. */
const timestampSchema = z.number().int().nonnegative();

/**
 * Validates the fields every object shares. Every object type extends
 * this schema, narrowing `type` to its own literal.
 *
 * Pages: a root object names its page in `pageId`, written with its placement; an
 * object in a group or frame has `pageId: null`, so a group or frame carries its subtree.
 *
 * Coordinate frames: an object's `x`, `y` and `rotation` place it in its parent's frame (the
 * board for `parentId: null`, else the group or frame named by `parentId`). The object's own
 * frame is the parent's frame translated by (`x`, `y`) and then rotated by `rotation` radians
 * about that point, so (`x`, `y`) is the object's local origin (the top-left corner of a box).
 * Points stored inside an object (line points, path vertices, free connector ends) are in the
 * object's own frame.
 *
 * `z` is the object's position in the stacking order among its siblings: a fractional-index
 * key compared by UTF-16 code units, higher drawn on top, checked by the
 * key rule (`isValidKey`); `@canvas/document` generates keys. Objects are strict:
 * an unknown key fails validation, so a malformed agent call cannot add fields.
 */
export const baseObjectSchema = z.strictObject({
  /** Child layout within a component or frame; absent means start/start. */
  constraints: constraintsSchema.optional(),
  /** The object id, unique within the board. */
  id: objectIdSchema,
  /** The kind of object; each object type narrows it to its own literal. */
  type: objectTypeSchema,
  /** The group or frame this object belongs to, or null for the board root. */
  parentId: objectIdSchema
    .nullable()
    .describe('The group or frame this object belongs to, or null for the board root.'),
  /**
   * The page of a root object; `null` for an object in a group or frame, which is on its root
   * ancestor's page. Absent on objects stored before pages: a root
   * object without it is on the default page (`DEFAULT_PAGE_ID`).
   */
  pageId: pageIdSchema
    .nullable()
    .optional()
    .describe(
      "The page of a root object; null for an object in a group or frame (it is on its root ancestor's page).",
    ),
  /** Local origin's x in the parent's frame, world units. */
  x: z.number().describe("Local origin's x in the parent's frame, world units."),
  /** Local origin's y in the parent's frame, world units. */
  y: z.number().describe("Local origin's y in the parent's frame, world units."),
  /** Rotation about the local origin, radians, clockwise on screen (y points down). */
  rotation: z
    .number()
    .describe('Rotation about the local origin, radians, clockwise on screen (y points down).'),
  /** Fractional-index key ordering siblings bottom to top (`isValidKey`); compared as strings. */
  z: zKeySchema.describe(
    'Fractional-index key ordering siblings bottom to top, compared as strings: base 62, a head letter stating the integer length (a0 is zero), no trailing 0, at most 512 characters.',
  ),
  /** Whether the object refuses selection and editing. */
  locked: z.boolean().describe('Whether the object refuses selection and editing.'),
  /** The principal whose command created the object. */
  createdBy: principalIdSchema,
  /** When the object was created, ms since the Unix epoch. */
  createdAt: timestampSchema.describe('When the object was created, ms since the Unix epoch.'),
  /** When the object last changed, ms since the Unix epoch. */
  updatedAt: timestampSchema.describe('When the object last changed, ms since the Unix epoch.'),
  /**
   * The layer name, up to 200 characters; absent for an unnamed object, which the
   * layers list labels by its type or content. Frames and mains always carry one.
   */
  name: z
    .string()
    .max(MAX_OBJECT_NAME_LENGTH)
    .optional()
    .describe('The layer name, up to 200 characters; absent for an unnamed object.'),
});

/** The fields every object shares. */
export type BaseObject = z.output<typeof baseObjectSchema>;

/**
 * The size fields of objects that store a box: the box spans (0, 0) to (`width`, `height`) in
 * the object's own frame. Groups, lines, paths, connectors and comments have no stored size;
 * a group's bounds are derived from its children.
 */
export const boxShape = {
  /** Box width in world units, at least 0. */
  width: z.number().nonnegative().describe('Box width in world units, at least 0.'),
  /** Box height in world units, at least 0. */
  height: z.number().nonnegative().describe('Box height in world units, at least 0.'),
  /**
   * How the box sits in an auto-layout container; ignored outside one. Only a box has
   * it: a line, path, connector, comment or group has no size of its own to fill with, and no
   * `size` group to store it in.
   */
  layoutChild: layoutChildSchema
    .optional()
    .describe('How the box sits in an auto-layout container; ignored outside one.'),
};
