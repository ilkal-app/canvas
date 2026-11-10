// The coverage faces a text asks for, and for the CJK faces which slices and weights:
// shared by the app's loading and the render page's, so both ask for the same files.

import type { FontWeight, StyleRun } from '@canvas/schema';

import { codepointAt } from '../layout/codepoints.js';
import { fallbackFamiliesOf, HAN_LANGUAGE_FAMILIES } from '../script/fallback-families.js';
import { effectiveLanguage, KanaParagraphs } from '../script/run-language.js';
import { scriptOf } from '../script/script-table.js';
import { cjkSliceOf } from '../slices/cjk-slices.js';

import { orderedScriptFamilies, scriptFamiliesOf } from './script-coverage.js';
import { symbolCoverageFamilies } from './symbol-coverage.js';

/** A coverage family a text needs, and for a CJK family the slices of it. */
export interface CoverageNeed {
  /** The family. */
  readonly family: string;
  /** For a sliced CJK family, the slice ids the text's characters are in; absent otherwise. */
  readonly slices?: readonly string[];
  /**
   * For a sliced CJK family, the weights of it the runs draw in: each run's nearest of the
   * faces' regular and bold; absent otherwise.
   */
  readonly weights?: readonly FontWeight[];
}

/** The scripts the CJK faces draw: Han, the kana, Hangul and Bopomofo. */
const CJK_SCRIPTS: ReadonlySet<string> = new Set(['Hani', 'Hira', 'Kana', 'Hang', 'Bopo']);

/**
 * The CJK face a character falls back to: Han's by language, the kana's, Hangul's, Bopomofo's.
 *
 * @param codepoint - The character.
 * @param lang - Its language at that index (`effectiveLanguage`).
 * @returns The family, or `undefined` for a character no CJK face is chosen for.
 */
function cjkFamilyOf(codepoint: number, lang: string | undefined): string | undefined {
  const script = scriptOf(codepoint);
  if (!CJK_SCRIPTS.has(script)) return undefined;
  return fallbackFamiliesOf(script, script === 'Hani' ? lang : undefined).find((family) =>
    HAN_LANGUAGE_FAMILIES.includes(family),
  );
}

/** A CJK family's slices and weights, gathered over a text. */
export interface CjkNeed {
  readonly slices: Set<string>;
  readonly weights: Set<FontWeight>;
}

/**
 * Each CJK family a text's characters are drawn in, with the slices those characters are in and
 * the weights of their runs: a run that names a CJK family draws its characters in it; any other
 * run's CJK characters fall back to the face their script and language pick. Pure.
 *
 * @param text - The text, or a piece of one inside a paragraph.
 * @param runs - Its runs; one regular run without a language when absent.
 * @param kana - Whether an index's paragraph has kana: the text's own by default, a longer
 *   text's for a piece of it (`CoverageNeedsCache`).
 * @returns The needs, by family, in the order first met.
 */
export function cjkNeeds(
  text: string,
  runs: readonly StyleRun[] | undefined,
  kana: Pick<KanaParagraphs, 'at'> = new KanaParagraphs(text),
): Map<string, CjkNeed> {
  const needs = new Map<string, CjkNeed>();
  let start = 0;
  for (const run of runs ?? [{ length: text.length, style: undefined }]) {
    const named = run.style?.fontFamily;
    // The nearest of regular and bold by CSS font matching (`nearestWeights`): bold above 500.
    const weight: FontWeight = (run.style?.weight ?? 400) > 500 ? 700 : 400;
    const end = start + run.length;
    for (let index = start; index < end;) {
      const { codepoint, length } = codepointAt(text, index);
      const family =
        named !== undefined && HAN_LANGUAGE_FAMILIES.includes(named)
          ? named
          : cjkFamilyOf(codepoint, effectiveLanguage(run.style?.lang, kana, index));
      if (family !== undefined) {
        const need = needs.get(family) ?? { slices: new Set(['base']), weights: new Set() };
        need.slices.add(cjkSliceOf(family, codepoint));
        need.weights.add(weight);
        needs.set(family, need);
      }
      index += length;
    }
    start = end;
  }
  return needs;
}

/**
 * The coverage families a text needs (its script faces, `scriptCoverageFamilies`, then its
 * symbol faces, `symbolCoverageFamilies`), and for each CJK family the
 * slices its characters are in (`cjkSliceOf`) and the weights it draws them in, with `base`
 * always, which holds the kana, punctuation and fullwidth forms set beside them. A run that names
 * a CJK family itself asks for it the same way, never whole. Pure.
 *
 * @param text - Board text or an editing draft.
 * @param runs - Its runs, whose languages pick Han's face and whose weights pick the faces'.
 * @returns The needs: the coverage families in that order, then any CJK family a
 *   run names.
 */
export function coverageNeeds(text: string, runs?: readonly StyleRun[]): readonly CoverageNeed[] {
  const kana = new KanaParagraphs(text);
  return assembleCoverageNeeds(
    scriptFamiliesOf(text, runs, kana),
    symbolCoverageFamilies(text),
    cjkNeeds(text, runs, kana),
  );
}

/**
 * A text's coverage needs from its parts, as `coverageNeeds` gives them: the script faces in list
 * order, then the symbol faces, then any CJK family a run names, each CJK family with its slices
 * and weights. Pure.
 *
 * @param scriptFamilies - The script faces the text needs (`scriptFamiliesOf`), in any order.
 * @param symbolFamilies - Its symbol faces (`symbolCoverageFamilies`).
 * @param cjk - Its CJK families' needs (`cjkNeeds`), in the order first met.
 * @returns The needs.
 */
export function assembleCoverageNeeds(
  scriptFamilies: ReadonlySet<string>,
  symbolFamilies: readonly string[],
  cjk: ReadonlyMap<string, CjkNeed>,
): readonly CoverageNeed[] {
  // A CJK family only for the characters given to it, so a run naming one face never asks the
  // face its script would otherwise fall back to.
  const families = [...orderedScriptFamilies(scriptFamilies), ...symbolFamilies].filter(
    (family) => !HAN_LANGUAGE_FAMILIES.includes(family) || cjk.has(family),
  );
  for (const family of cjk.keys()) if (!families.includes(family)) families.push(family);
  // Every CJK family left is one some character was given to, so it has its need.
  return families.map((family) => {
    const need = cjk.get(family);
    return need === undefined
      ? { family }
      : { family, slices: [...need.slices], weights: [...need.weights] };
  });
}
