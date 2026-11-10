import { z } from 'zod';

import { pointSchema } from '../fields/point.js';
import { objectIdSchema } from '../ids/object-id.js';

import { baseObjectSchema } from './base-object.js';

/**
 * Validates where a comment pin is anchored.
 *
 * - `{ kind: 'point' }`: at the comment's own `x`, `y` in its parent's frame.
 * - `{ kind: 'object', objectId, offset }`: on another object, at `offset` in that object's
 *   own frame, so the pin moves with it; the comment's `x`, `y` are not used for drawing. When
 *   the object is deleted the anchor becomes a point where the pin was, as a connector end does.
 */
export const commentAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    /** Anchored to a point: the comment's own `x`, `y`. */
    kind: z.literal('point'),
  }),
  z.strictObject({
    /** Anchored to an object. */
    kind: z.literal('object'),
    /** The object the pin is attached to. */
    objectId: objectIdSchema.describe('The object the pin is attached to.'),
    /** Where the pin sits, in the anchor object's own frame. */
    offset: pointSchema.describe("Where the pin sits, in the anchor object's own frame."),
  }),
]);

/** Where a comment pin is anchored: a point, or an object. */
export type CommentAnchor = z.output<typeof commentAnchorSchema>;

/**
 * Validates a comment object: only the anchor of a comment thread. The
 * thread and its messages are stored relationally, keyed by `threadId`, and never enter
 * the document.
 */
export const commentObjectSchema = baseObjectSchema
  .extend({
    /** Always `'comment'`: the discriminator of this object type. */
    type: z.literal('comment'),
    /** The id of the comment thread in the relational store. */
    threadId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/, 'a thread id is 1 to 128 letters, digits, "_" or "-"')
      .describe('The id of the comment thread in the relational store.'),
    /** Where the comment pin is anchored. */
    anchor: commentAnchorSchema.describe('Where the comment pin is anchored.'),
  })
  .describe('The anchor of a comment thread; the messages live outside the document.');

/** A comment object. */
export type CommentObject = z.output<typeof commentObjectSchema>;
