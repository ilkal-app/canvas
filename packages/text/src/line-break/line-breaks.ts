// The Unicode line breaking algorithm (UAX #14, revision 55, Unicode 17.0.0): where a
// line may end and where it must. Characters are grouped as rule LB9 says, a character with the
// combining marks and joiners after it, and each boundary between two groups is decided by the
// first rule, LB4 to LB31, that matches it. Runs of SA characters (Thai, Lao, Khmer, Myanmar),
// which have no spaces between words, may also break where the runtime's word segmenter finds a
// word boundary (LB1's dictionary resolution).

import { elementAt } from './element-at.js';
import { classOfValue, lineBreakValueOf } from './line-break-class.js';
import { BREAK, groupsOf, type Groups, MANDATORY, NONE } from './line-break-groups.js';
import { boundaryBefore } from './line-break-rules.js';

/** A place a line may, or must, end: before `text[index]`. */
export interface LineBreakOpportunity {
  /** The UTF-16 index the next line would start at; 0 < index <= text.length. */
  readonly index: number;
  /** Whether the line must end there: after BK, CR, LF or NL, and at the end of the text. */
  readonly isMandatory: boolean;
}

/** How to break lines. */
export interface LineBreakOptions {
  /**
   * How LB1 resolves SA (Thai, Lao, Khmer, Myanmar and others): `dictionary` (the default) also
   * breaks at the runtime's word boundaries inside an SA run; `none` resolves SA as AL, or CM for
   * a mark, which is what Unicode's conformance test expects.
   */
  readonly complexContext?: 'dictionary' | 'none';
}

let wordSegmenter: Intl.Segmenter | undefined;

/**
 * The word boundaries inside an SA run, from the runtime's dictionary-based word segmenter.
 *
 * @param text - The text.
 * @param start - The run's first UTF-16 index.
 * @param end - One past its last.
 * @returns The boundaries strictly inside the run.
 */
function dictionaryBoundaries(text: string, start: number, end: number): number[] {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return [];
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  const boundaries: number[] = [];
  for (const { index } of wordSegmenter.segment(text.slice(start, end))) {
    if (index > 0) boundaries.push(start + index);
  }
  return boundaries;
}

/**
 * Every place a line may or must end in a text, by UAX #14 of Unicode 17.0.0, the end of the
 * text included.
 *
 * @param text - The text.
 * @param options - How to resolve SA.
 * @returns The opportunities, in order.
 */
export function lineBreakOpportunities(
  text: string,
  options: LineBreakOptions = {},
): LineBreakOpportunity[] {
  if (text.length === 0) return [];
  const { groups, decisions } = decide(text, options);
  const opportunities: LineBreakOpportunity[] = [];
  for (let k = 1; k < groups.count; k += 1) {
    const decision = decisions[k];
    if (decision !== NONE) {
      opportunities.push({
        index: elementAt(groups.starts, k),
        isMandatory: decision === MANDATORY,
      });
    }
  }
  opportunities.push({ index: text.length, isMandatory: true }); // LB3
  return opportunities;
}

/**
 * The text's groups and the decision on the boundary before each.
 *
 * @param text - The text, not empty.
 * @param options - How to resolve SA.
 * @returns The groups, and each boundary's decision by the group after it.
 */
function decide(
  text: string,
  options: LineBreakOptions,
): { groups: Groups; decisions: Uint8Array } {
  const groups = groupsOf(text);
  const decisions = new Uint8Array(groups.count + 1);
  for (let k = 1; k < groups.count; k += 1) decisions[k] = boundaryBefore(groups, k);
  if ((options.complexContext ?? 'dictionary') === 'dictionary') {
    breakComplexRuns(text, groups, decisions);
  }
  return { groups, decisions };
}

/**
 * Adds breaks at dictionary word boundaries between two groups of an SA run.
 *
 * @param text - The text.
 * @param groups - Its groups.
 * @param decisions - Each boundary's decision, by the group after it; updated.
 */
function breakComplexRuns(text: string, groups: Groups, decisions: Uint8Array): void {
  for (let k = 0; k < groups.count;) {
    if (groups.isComplex[k] !== 1) {
      k += 1;
      continue;
    }
    let end = k + 1;
    while (end < groups.count && groups.isComplex[end] === 1) end += 1;
    if (end - k > 1) {
      const runEnd = end < groups.count ? elementAt(groups.starts, end) : text.length;
      const boundaries = new Set(dictionaryBoundaries(text, elementAt(groups.starts, k), runEnd));
      for (let j = k + 1; j < end; j += 1) {
        // Never after a zero width joiner, which LB8a keeps with what follows.
        const isJoined = groups.endsWithJoiner[j - 1] === 1;
        if (!isJoined && boundaries.has(elementAt(groups.starts, j))) decisions[j] = BREAK;
      }
    }
    k = end;
  }
}

/** No line break before an index. */
export const NO_BREAK = NONE;
/** A line may end before an index. */
export const ALLOWED_BREAK = BREAK;
/** A line must end before an index. */
export const MANDATORY_BREAK = MANDATORY;

/**
 * What may happen before each UTF-16 index of a text, for line breakers: `NO_BREAK`,
 * `ALLOWED_BREAK` or `MANDATORY_BREAK` (`lineBreakOpportunities`, as an array by index).
 *
 * @param text - The text.
 * @returns One entry per index, 0 to `text.length`.
 */
export function lineBreakKinds(text: string): Uint8Array {
  const kinds = new Uint8Array(text.length + 1);
  if (text.length === 0) return kinds;
  const { groups, decisions } = decide(text, {});
  for (let k = 1; k < groups.count; k += 1) {
    kinds[elementAt(groups.starts, k)] = elementAt(decisions, k);
  }
  kinds[text.length] = MANDATORY; // LB3
  return kinds;
}

/**
 * Whether a character ends a line by itself (Line_Break BK, CR, LF or NL): LF, VT, FF, CR, NEL
 * and the line and paragraph separators. Each is in the Basic Multilingual Plane.
 *
 * @param code - A UTF-16 code unit.
 * @returns Whether it is.
 */
export function isLineTerminator(code: number): boolean {
  const name = classOfValue(lineBreakValueOf(code));
  return name === 'BK' || name === 'CR' || name === 'LF' || name === 'NL';
}
