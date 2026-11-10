// A grapheme cluster's script, for choosing its fallback face.

import { codepointAt } from '../layout/codepoints.js';

import { scriptOf, type ScriptCode } from './script-table.js';

/** The scripts that take their script from the text around them. */
const COMMON = 'Zyyy';
const INHERITED = 'Zinh';

/**
 * The script of a grapheme cluster: the Script of its first codepoint that is neither Common nor
 * Inherited; when it has none (digits, punctuation, emoji, a lone mark), the script of the cluster
 * before it, so a run of Common characters inside Thai text stays with Thai; else Common. (A
 * Common character's Script_Extensions, such as U+30FC's Hiragana and Katakana, never changes the
 * answer: the script before it is taken either way.)
 *
 * @param text - The text.
 * @param start - The cluster's first UTF-16 index.
 * @param end - One past its last.
 * @param previous - The script of the cluster before it, if any.
 * @returns The cluster's script, an ISO 15924 short name.
 */
export function clusterScript(
  text: string,
  start: number,
  end: number,
  previous?: ScriptCode,
): ScriptCode {
  for (let index = start; index < end;) {
    const { codepoint, length } = codepointAt(text, index);
    const script = scriptOf(codepoint);
    if (script !== COMMON && script !== INHERITED) return script;
    index += length;
  }
  return previous ?? COMMON;
}
