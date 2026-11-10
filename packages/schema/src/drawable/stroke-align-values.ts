import { STROKE_ALIGNS } from '../fields/stroke-align.js';

import type { PaintValueFinding } from './paint-values.js';

// The door's judgement of stroke alignment: the `strokeAlign` member of a `style`
// value a peer writes, judged as the schema would accept it, from a value that may be anything.
// A frame's new `stroke` needs no rule of its own: the style group's `stroke` is judged by
// `strokeValueReason` whatever the object. Pure.

/** The alignments the schema accepts. */
const ALIGNS: ReadonlySet<unknown> = new Set(STROKE_ALIGNS);

/**
 * The door's judgement of a shape's or frame's stroke alignment as a peer wrote it:
 * absent, or exactly one of `STROKE_ALIGNS` (`'inside'`, `'center'`, `'outside'`). Anything else
 * (`null`, another string, a number) is refused as `out-of-range`. The engine reads a value that
 * skipped the door as inside. Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The finding (field `''`), or undefined when acceptable.
 */
export function strokeAlignValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined || ALIGNS.has(value)) return undefined;
  return { field: '', reason: 'out-of-range' };
}
