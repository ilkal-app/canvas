// Which families are coverage faces: the script and symbol faces fallback draws in,
// by name, so faces outside "Noto Sans" (Noto Color Emoji, Noto Serif Tibetan) count and a library
// family that happens to start with "Noto" does not.

import { SCRIPT_COVERAGE_FAMILIES } from './script-coverage.js';
import { SYMBOL_COVERAGE_FAMILIES } from './symbol-coverage.js';

const COVERAGE_FAMILIES: ReadonlySet<string> = new Set([
  ...SCRIPT_COVERAGE_FAMILIES,
  ...SYMBOL_COVERAGE_FAMILIES,
]);

/**
 * Whether a family is a coverage face: a script or symbol face that fallback draws in, hidden
 * from the font picker.
 *
 * @param family - The family.
 * @returns True for a coverage face.
 */
export function isCoverageFamily(family: string): boolean {
  return COVERAGE_FAMILIES.has(family);
}
