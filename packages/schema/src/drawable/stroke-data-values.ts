import type { UndrawableReason } from './drawable-extent.js';
import type { StoredValueMatch } from './stored-value-match.js';

/** A refused number of a freehand stroke's stored array: its index, and why. */
export interface NumberListFinding {
  /** The index, as a dotted path segment (`'3'`); `''` for the whole array. */
  readonly field: string;
  /** Why it is refused: out of its range, not a number, or the whole value not an array. */
  readonly reason: UndrawableReason | 'not-a-number' | 'not-a-record';
}

/**
 * Judges a flat array of numbers, each by one rule, as the door reads a freehand stroke's
 * `strokePoints` or `strokePressures`: not an array is refused whole, and each number
 * out of its rule's range is refused at its index, unless the write leaves it as the board holds
 * it (`StoredValueMatch`).
 *
 * @param values - The array, as written.
 * @param rule - Each number's rule.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
export function numbersFinding(
  values: unknown,
  rule: (value: number) => UndrawableReason | undefined,
  match: StoredValueMatch,
): NumberListFinding | undefined {
  if (!Array.isArray(values)) {
    return match.isUnchanged([], values) ? undefined : { field: '', reason: 'not-a-record' };
  }
  for (const [index, value] of (values as readonly unknown[]).entries()) {
    const reason = typeof value === 'number' ? rule(value) : 'not-a-number';
    if (reason !== undefined && !match.isUnchanged([String(index)], value)) {
      return { field: String(index), reason };
    }
  }
  return undefined;
}
