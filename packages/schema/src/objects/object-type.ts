import { z } from 'zod';

/** The object types. */
export const OBJECT_TYPES = [
  'text',
  'sticky',
  'image',
  'video',
  'shape',
  'line',
  'connector',
  'path',
  'freehand',
  'group',
  'frame',
  'comment',
  'component',
  'instance',
  'link',
] as const;

/** Validates an object's `type` discriminator: one of {@link OBJECT_TYPES}. */
export const objectTypeSchema = z.enum(OBJECT_TYPES).describe('The kind of object.');

/** One of the object types. */
export type ObjectType = (typeof OBJECT_TYPES)[number];
