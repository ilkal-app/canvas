import { z } from 'zod';

import { commentObjectSchema } from './comment-object.js';
import { componentObjectSchema } from './component-object.js';
import { connectorObjectSchema } from './connector-object.js';
import { frameObjectSchema } from './frame-object.js';
import { freehandObjectSchema } from './freehand-object.js';
import { groupObjectSchema } from './group-object.js';
import { imageObjectSchema } from './image-object.js';
import { instanceObjectSchema } from './instance-object.js';
import { lineObjectSchema } from './line-object.js';
import { linkObjectSchema } from './link-object.js';
import type { ObjectType } from './object-type.js';
import { pathObjectSchema } from './path-object.js';
import { shapeObjectSchema } from './shape-object.js';
import { stickyObjectSchema } from './sticky-object.js';
import { textObjectSchema } from './text-object.js';
import { videoObjectSchema } from './video-object.js';

/**
 * Validates any board object, dispatching on `type` to the schema of that object type.
 * The command layer validates every object against this schema before
 * it becomes a transaction; references to other objects are checked against a whole
 * board by `validateBoard`.
 */
export const boardObjectSchema = z.discriminatedUnion('type', [
  textObjectSchema,
  stickyObjectSchema,
  imageObjectSchema,
  videoObjectSchema,
  shapeObjectSchema,
  lineObjectSchema,
  connectorObjectSchema,
  pathObjectSchema,
  freehandObjectSchema,
  groupObjectSchema,
  frameObjectSchema,
  commentObjectSchema,
  componentObjectSchema,
  instanceObjectSchema,
  linkObjectSchema,
]);

/** Any object on a board: the union of the supported object types, discriminated by `type`. */
export type BoardObject = z.output<typeof boardObjectSchema>;

/** The board object of one type, for example `BoardObjectOf<'frame'>` is `FrameObject`. */
export type BoardObjectOf<Type extends ObjectType> = Extract<
  BoardObject,
  {
    /** The object type to select. */
    type: Type;
  }
>;
