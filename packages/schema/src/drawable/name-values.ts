import { MAX_OBJECT_NAME_LENGTH } from '../objects/base-object.js';

import type { PaintValueFinding } from './paint-values.js';

// The door's judgement of a layer name: the `name` member of a `style` value a peer
// writes, judged as the schema would accept it, from a value that may be anything. Pure.

/**
 * The door's judgement of an object's layer name as a peer wrote it: absent, or a string
 * of at most {@link MAX_OBJECT_NAME_LENGTH}. Anything else (`null`, a number, a longer string) is
 * refused as `out-of-range`. A frame's or main's name is judged the same way. Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The finding (field `''`), or undefined when acceptable.
 */
export function objectNameValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.length <= MAX_OBJECT_NAME_LENGTH) return undefined;
  return { field: '', reason: 'out-of-range' };
}
