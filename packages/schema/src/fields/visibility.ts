import { z } from 'zod';

/**
 * The layer visibility field that every layer but a comment spreads into its schema:
 * an optional `isHidden`. Absent is shown, what every object stored before the field had, so it
 * draws as before; a style patch removes it by writing `undefined`. A hidden layer and
 * everything inside it is not drawn, cannot be hit on the canvas and takes no space in an
 * auto-layout; an instance's record (its own or a preset's) says otherwise for a main's child.
 */
export const visibilityShape = {
  /** Whether the layer and everything inside it is hidden; absent is shown. */
  isHidden: z
    .boolean()
    .optional()
    .describe(
      'Whether the layer and everything inside it is hidden: not drawn, not hit, no space in an auto-layout. Absent is shown.',
    ),
};

/** The object types that store an optional `isHidden` ({@link visibilityShape}): all but a comment. */
export const LAYER_VISIBILITY_TYPES = [
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
  'component',
  'instance',
] as const;

/**
 * Whether a stored object is hidden: only a stored `true`; absent, and anything the
 * schema refuses, is shown. Pure.
 *
 * @param object - The stored object, or anything.
 * @returns Whether it is hidden.
 */
export function isStoredHidden(object: unknown): boolean {
  return typeof object === 'object' && object !== null && Reflect.get(object, 'isHidden') === true;
}

/**
 * An object without its stored `isHidden`: what an instance draws for a main's child
 * a record shows, so nothing downstream reads the main's hiding. Pure: a new object, or the same
 * one when it stores none.
 *
 * @param object - The object.
 * @returns The object without `isHidden`.
 */
export function withoutStoredHidden<Value extends object>(object: Value): Value {
  if (!Object.hasOwn(object, 'isHidden')) return object;
  const copy = { ...object };
  Reflect.deleteProperty(copy, 'isHidden');
  return copy;
}
