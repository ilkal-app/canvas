// Which Noto script face the app loads for which script (moved the list here from the
// app; derives it from the UCD script table).

import type { StyleRun } from '@canvas/schema';

import { codepointAt } from '../layout/codepoints.js';
import {
  fallbackFamiliesOf,
  HAN_LANGUAGE_FAMILIES,
  SCRIPT_FALLBACKS,
} from '../script/fallback-families.js';
import { effectiveLanguage, KanaParagraphs } from '../script/run-language.js';
import { scriptOf } from '../script/script-table.js';

/**
 * The Noto script faces, in list order, hidden from the picker and loaded only for text in their
 * script.
 */
export const SCRIPT_COVERAGE_FAMILIES: readonly string[] = [
  ...new Set([...SCRIPT_FALLBACKS.map(([, family]) => family), ...HAN_LANGUAGE_FAMILIES]),
];

/**
 * The Noto script faces a text needs: one for each script it holds that the app has a face for.
 * Like the symbol faces they are hidden from the font picker and loaded only for text that needs
 * them. Given the text's runs, Han takes the face of its run's language, or Japanese where its
 * paragraph holds kana: the first of that language's faces the app has. Pure.
 *
 * @param text - Board text or an editing draft.
 * @param runs - Its style runs, for their languages; without them Han takes Simplified Chinese.
 * @returns The families, one per script present, in list order.
 */
export function scriptCoverageFamilies(
  text: string,
  runs?: readonly StyleRun[],
): readonly string[] {
  return orderedScriptFamilies(scriptFamiliesOf(text, runs, new KanaParagraphs(text)));
}

/**
 * The Noto script faces a text needs, unordered (`scriptCoverageFamilies` before its list
 * order), with its paragraphs' kana given: a piece of a longer text reads its paragraph's
 * (`CoverageNeedsCache`). Pure.
 *
 * @param text - The text, or a piece of one inside a paragraph.
 * @param runs - Its style runs, as `scriptCoverageFamilies` takes them.
 * @param kana - Whether an index's paragraph has kana.
 * @returns The families.
 */
export function scriptFamiliesOf(
  text: string,
  runs: readonly StyleRun[] | undefined,
  kana: Pick<KanaParagraphs, 'at'>,
): Set<string> {
  const needed = new Set<string>();
  const langAt = runLanguages(runs);
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    const script = scriptOf(codepoint);
    if (script === 'Hani' && runs !== undefined) {
      const lang = effectiveLanguage(langAt(index), kana, index);
      const [family] = fallbackFamiliesOf(script, lang).filter((it) => AVAILABLE.has(it));
      if (family !== undefined) needed.add(family);
    } else for (const family of fallbackFamiliesOf(script)) needed.add(family);
    index += length;
  }
  return needed;
}

/**
 * Script faces in list order (`SCRIPT_COVERAGE_FAMILIES`).
 *
 * @param needed - The faces a text needs, in any order.
 * @returns Those faces in list order.
 */
export function orderedScriptFamilies(needed: ReadonlySet<string>): readonly string[] {
  return SCRIPT_COVERAGE_FAMILIES.filter((family) => needed.has(family));
}

/** The script faces the app has. */
const AVAILABLE: ReadonlySet<string> = new Set(SCRIPT_COVERAGE_FAMILIES);

/**
 * A text's language at each index, from its runs, read with a cursor: the indices asked must not
 * decrease, so a text is read in one pass however many runs it has.
 *
 * @param runs - The runs, if given.
 * @returns The language at an index, or `undefined`.
 */
function runLanguages(
  runs: readonly StyleRun[] | undefined,
): (index: number) => string | undefined {
  const list = runs ?? [];
  let position = 0;
  let end = list[0]?.length ?? 0;
  return (index) => {
    while (position < list.length && index >= end) {
      position += 1;
      end += list[position]?.length ?? 0;
    }
    return list[position]?.style.lang;
  };
}

/**
 * Whether a character is in a script the app has a Noto script face for. Where those
 * faces' metrics are not at hand (the MCP server measures with the bundled and symbol faces
 * only), such a character is taken as drawn rather than reported missing. Pure.
 *
 * @param codePoint - The character.
 * @returns True when a script face is loaded for it.
 */
export function hasScriptCoverage(codePoint: number): boolean {
  return fallbackFamiliesOf(scriptOf(codePoint)).length > 0;
}
