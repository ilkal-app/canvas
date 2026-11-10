import { z } from 'zod';

import {
  angleSchema,
  commentObjectSchema,
  componentObjectSchema,
  connectorObjectSchema,
  frameObjectSchema,
  freehandObjectSchema,
  groupObjectSchema,
  imageObjectSchema,
  instanceObjectSchema,
  lineObjectSchema,
  linkObjectSchema,
  objectIdSchema,
  overrideFieldsSchema,
  pageIdSchema,
  pathObjectSchema,
  shapeObjectSchema,
  stickyObjectSchema,
  textObjectSchema,
  videoObjectSchema,
  zKeySchema,
} from '@canvas/schema';

import { overridePathInputSchema } from './override-path-names.js';

/**
 * How a new object's fields differ from a stored object's: the command generates the id unless
 * one is given, places the object on top of its siblings unless a `z` is given, and stamps
 * `createdBy` (from the origin), `createdAt` and `updatedAt` (from the clock) itself, so those
 * three must be left out. `parentId`, `rotation` and `locked` default to the root, 0 and false.
 */
const CREATION_FIELDS = {
  /** The new object's id; generated when omitted. */
  id: objectIdSchema.optional().describe("The new object's id; generated when omitted."),
  /** The group or frame the object goes in, or null (the default) for the board root. */
  parentId: objectIdSchema
    .nullable()
    .default(null)
    .describe('The group or frame the object goes in, or null (the default) for the board root.'),
  /** The page of a root object; omitted: the board's first page. */
  pageId: pageIdSchema
    .nullable()
    .optional()
    .describe(
      "The page of a root object; omit for the board's first page. An object in a group or frame is on its parent's page.",
    ),
  /** Rotation about the local origin, radians; default 0. */
  rotation: angleSchema.default(0).describe('Rotation about the local origin, radians; default 0.'),
  /**
   * Stacking key among siblings, a fractional-index key (`isValidKey`); omit to place the
   * object on top. A key that is not one would make every later placement above it impossible.
   */
  z: zKeySchema
    .optional()
    .describe(
      'Stacking key among siblings, a fractional-index key (base 62, e.g. "a0"); omit to place the object on top.',
    ),
  /** Whether the object starts locked; default false. */
  locked: z.boolean().default(false).describe('Whether the object starts locked; default false.'),
  /** Set by the command from the origin; must be omitted. */
  createdBy: z.never().optional().describe('Set by the command from the origin; must be omitted.'),
  /** Set by the command from its clock; must be omitted. */
  createdAt: z.never().optional().describe('Set by the command from its clock; must be omitted.'),
  /** Set by the command from its clock; must be omitted. */
  updatedAt: z.never().optional().describe('Set by the command from its clock; must be omitted.'),
};

/**
 * Validates the frame `createFrame` is asked to create: a frame's own fields, with the creation
 * fields of {@link newObjectSchema} (`id` and `z` optional; `parentId`, `rotation` and `locked`
 * defaulted; the stamps left out). Strict.
 */
export const newFrameObjectSchema = z.strictObject({
  ...frameObjectSchema.shape,
  ...CREATION_FIELDS,
});

/**
 * Validates the object `createObject` is asked to create: any object type of the
 * schema with its own fields as the schema defines them. Of the shared fields, `id` and `z` are
 * optional, `parentId`, `rotation` and `locked` default to the root, 0 and false, and
 * `createdBy`, `createdAt` and `updatedAt` must be left out: the command sets them. Discriminated
 * by `type`; strict, like the object schemas.
 * It checks the shape of each field; the rules across fields (text runs covering the text, a
 * well-formed vector network) are checked on the whole object `createObject` builds, and
 * reported as `invalid-object`. (Zod cannot override fields of a schema with refinements.)
 */
export const newObjectSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...textObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...stickyObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...imageObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...videoObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...shapeObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...lineObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...connectorObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...pathObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...freehandObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...groupObjectSchema.shape, ...CREATION_FIELDS }),
  newFrameObjectSchema,
  z.strictObject({ ...commentObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({ ...componentObjectSchema.shape, ...CREATION_FIELDS }),
  z.strictObject({
    ...instanceObjectSchema.shape,
    ...CREATION_FIELDS,
    /**
     * Per-child overrides by override path: an id path, or layer names. createObjects
     * resolves them to id paths before the stored-object checks, which a single
     * createObject, resolving none, refuses.
     */
    overrides: z
      .record(overridePathInputSchema, overrideFieldsSchema)
      .describe(
        "Per-child overrides keyed by override path: child ids as query_board lists them, or the layers' names down to the child.",
      ),
  }),
  z.strictObject({ ...linkObjectSchema.shape, ...CREATION_FIELDS }),
]);

/** An object to create, as `createObject` takes it (after parsing: defaults filled in). */
export type NewObject = z.output<typeof newObjectSchema>;
