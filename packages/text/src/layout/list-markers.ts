import { MAX_LIST_LEVEL, type ParagraphStyle } from '@canvas/schema';

/** How far each list level indents its paragraph, in em of the paragraph's first run. */
export const LIST_INDENT_EM = 1.5;

/** The space between a list marker and its paragraph's text, in em. */
export const MARKER_GAP_EM = 0.5;

/** Bullets by level: a filled disc, a ring, a square, then the disc again (owner design). */
const BULLETS = ['•', '◦', '▪', '•'] as const;

/** The largest ordinal written in roman numerals; larger ones fall back to decimal. */
const MAX_ROMAN = 3999;

const ROMAN_STEPS: readonly (readonly [value: number, numeral: string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/**
 * The number each numbered list paragraph shows. Counters run per level: a numbered
 * paragraph counts up its level and restarts every deeper one; a bullet paragraph restarts its
 * level and every deeper one; a plain paragraph restarts them all. Pure.
 *
 * @param paragraphs - One style per paragraph.
 * @returns Each paragraph's ordinal, or `undefined` for a paragraph that is not numbered.
 */
export function listOrdinalsOf(
  paragraphs: readonly ParagraphStyle[],
): readonly (number | undefined)[] {
  const counters = new Array<number>(MAX_LIST_LEVEL + 1).fill(0);
  return paragraphs.map(({ list, level = 0 }) => {
    const from = list === undefined ? 0 : list === 'numbered' ? level + 1 : level;
    counters.fill(0, from);
    if (list !== 'numbered') return undefined;
    counters[level] = (counters[level] ?? 0) + 1;
    return counters[level];
  });
}

/**
 * Lower-case letters for an ordinal, bijective base 26: a … z, aa, ab ….
 *
 * @param ordinal - A positive integer.
 * @returns The letters.
 */
function lettersOf(ordinal: number): string {
  let letters = '';
  for (let rest = ordinal; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(97 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

/**
 * Lower-case roman numerals for an ordinal up to {@link MAX_ROMAN}.
 *
 * @param ordinal - A positive integer.
 * @returns The numerals.
 */
function romanOf(ordinal: number): string {
  let numerals = '';
  let rest = ordinal;
  for (const [value, numeral] of ROMAN_STEPS) {
    for (; rest >= value; rest -= value) numerals += numeral;
  }
  return numerals;
}

/**
 * The marker drawn before a list paragraph (owner design): bullets • ◦ ▪ • by level;
 * numbers 1. / a. / i. / 1. by level, roman numerals past 3999 falling back to decimal. Pure.
 *
 * @param style - The paragraph's style.
 * @param ordinal - Its ordinal from {@link listOrdinalsOf}, for a numbered paragraph.
 * @returns The marker, or `undefined` for a plain paragraph.
 */
export function listMarkerOf(
  style: ParagraphStyle,
  ordinal: number | undefined,
): string | undefined {
  const level = style.level ?? 0;
  if (style.list === 'bullet') return BULLETS[level];
  if (style.list !== 'numbered') return undefined;
  const n = ordinal ?? 1;
  if (level === 1) return `${lettersOf(n)}.`;
  if (level === 2 && n <= MAX_ROMAN) return `${romanOf(n)}.`;
  return `${String(n)}.`;
}
