// Text styles for the run and editor tests: a base style and variants that differ in one field.
import type { StyleRun, TextStyle } from '@canvas/schema';

/** The base style: Liberation Sans 16, near-black, regular, upright. */
export const BASE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 16,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

/** The base style in bold. */
export const BOLD: TextStyle = { ...BASE, weight: 700 };

/** The base style in red. */
export const RED: TextStyle = { ...BASE, color: [1, 0, 0, 1] };

/** The base style at 32. */
export const LARGE: TextStyle = { ...BASE, fontSize: 32 };

/**
 * Runs from `[length, style]` pairs.
 *
 * @param pairs - Each run's length and style.
 * @returns The runs.
 */
export function runsOf(...pairs: readonly (readonly [number, TextStyle])[]): StyleRun[] {
  return pairs.map(([length, style]) => ({ length, style }));
}
