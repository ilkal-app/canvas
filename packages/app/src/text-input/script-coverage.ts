import type { StyleRun } from '@canvas/schema';
import {
  HAN_LANGUAGE_FAMILIES,
  scriptCoverageFamilies,
  symbolCoverageFamilies,
} from '@canvas/text';

/**
 * Finds coverage families without changing text or depending on browser locale: the script
 * families for the scripts present (`scriptCoverageFamilies`), then the symbol faces for the symbols present (
 * `symbolCoverageFamilies`).
 *
 * @param text - Board text or an editing draft.
 * @param runs - Its runs, whose languages pick Han's face; without them, Simplified
 *   Chinese.
 * @returns Only the families needed by scripts and symbols present in the text.
 */
export function coverageFamilies(text: string, runs?: readonly StyleRun[]): readonly string[] {
  return [...scriptCoverageFamilies(text, runs), ...symbolCoverageFamilies(text)];
}

export { coverageNeeds, CoverageNeedsCache, type CoverageNeed } from '@canvas/text';

/**
 * Whether a family is a sliced CJK coverage family, which is only ever loaded by slice.
 *
 * @param family - The family.
 * @returns True for Noto Sans SC, TC, HK, JP and KR.
 */
export function isSlicedFamily(family: string): boolean {
  return HAN_LANGUAGE_FAMILIES.includes(family);
}
