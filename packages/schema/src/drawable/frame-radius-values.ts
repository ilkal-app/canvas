import type { PaintValueFinding } from './paint-values.js';

// The judgement of a frame's stored corner rounding: the `cornerRadius` member of a
// frame's `style` value, judged as `frameCornerRadiusSchema` would accept it, from a value that
// may be anything. The relay's door does not apply it, as it does not judge a shape's radius
// (the style group's door is type-blind, and the sync fuzz writes refused radii a reader
// must tolerate); the codec reads a refused one as sharp and carries it through
// (`radius-tolerance.ts` in `@canvas/document`). How large a radius may be is the value limits'
// rule (`findValueLimitIssues`), which commands and `importBoard` apply. Pure.

/**
 * Judges one corner: a finite number at least 0.
 *
 * @param value - The value.
 * @param field - Its path.
 * @returns The finding, or undefined.
 */
function cornerFinding(value: unknown, field: string): PaintValueFinding | undefined {
  if (typeof value !== 'number') return { field, reason: 'not-a-number' };
  if (!Number.isFinite(value)) return { field, reason: 'not-finite' };
  return value < 0 ? { field, reason: 'negative-size' } : undefined;
}

/**
 * The judgement of a frame's corner rounding as a peer wrote it: absent, a
 * finite number at least 0, or a tuple of four of them (`[topLeft, topRight, bottomRight,
 * bottomLeft]`). A tuple of another length, or another kind of value, is `not-a-record`; a
 * corner is named by its index (`2`). The engine reads a value that skipped the door as sharp.
 * Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The finding (field `''` for the whole value), or undefined when acceptable.
 */
export function frameCornerRadiusReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return cornerFinding(value, '');
  if (!Array.isArray(value) || value.length !== 4) return { field: '', reason: 'not-a-record' };
  for (let corner = 0; corner < 4; corner += 1) {
    const finding = cornerFinding((value as readonly unknown[])[corner], String(corner));
    if (finding !== undefined) return finding;
  }
  return undefined;
}
