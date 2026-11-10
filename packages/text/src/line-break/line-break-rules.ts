// The rules of the Unicode line breaking algorithm (UAX #14, revision 55, Unicode 17.0.0;
//), LB4 to LB31, deciding each boundary between two of the groups LB9 forms.

import { elementAt } from './element-at.js';
import {
  FLAG_EXTENDED_PICTOGRAPHIC_UNASSIGNED,
  FLAG_FINAL_PUNCTUATION,
  FLAG_INITIAL_PUNCTUATION,
} from './line-break-class.js';
import {
  BREAK,
  C,
  classAt,
  DOTTED_CIRCLE,
  type Groups,
  hasFlag,
  isEastAsianAt,
  MANDATORY,
  NONE,
} from './line-break-groups.js';

/** What may come before an unresolved initial quotation mark that LB15a holds to what follows it. */
const QUOTE_OPENERS = new Set([-1, C.BK, C.CR, C.LF, C.NL, C.OP, C.QU, C.GL, C.SP, C.ZW]);
/** What may follow an unresolved final quotation mark that LB15b holds to what precedes it. */
const QUOTE_CLOSERS = new Set([
  -1,
  C.SP,
  C.GL,
  C.WJ,
  C.CL,
  C.QU,
  C.CP,
  C.EX,
  C.IS,
  C.SY,
  C.BK,
  C.CR,
  C.LF,
  C.NL,
  C.ZW,
]);
/** What may come before a hyphen that LB20a holds to the letter after it. */
const HYPHEN_STARTERS = new Set([-1, C.BK, C.CR, C.LF, C.NL, C.SP, C.ZW, C.CB, C.GL]);

/**
 * Decides the boundary before group `k` (LB4–LB31).
 *
 * @param g - The groups.
 * @param k - The group after the boundary, 1 to `count - 1`.
 * @returns NONE, BREAK or MANDATORY.
 */
export function boundaryBefore(g: Groups, k: number): number {
  const a = classAt(g, k - 1);
  const b = classAt(g, k);
  if (a === C.BK) return MANDATORY; // LB4
  if (a === C.CR && b === C.LF) return NONE; // LB5
  if (a === C.CR || a === C.LF || a === C.NL) return MANDATORY;
  if (b === C.BK || b === C.CR || b === C.LF || b === C.NL) return NONE; // LB6
  if (b === C.SP || b === C.ZW) return NONE; // LB7
  let s = k - 1; // the last group before the boundary that is not a space
  while (s >= 0 && classAt(g, s) === C.SP) s -= 1;
  const beforeSpaces = classAt(g, s);
  if (beforeSpaces === C.ZW) return BREAK; // LB8
  if (g.endsWithJoiner[k - 1] === 1) return NONE; // LB8a
  if (a === C.WJ || b === C.WJ) return NONE; // LB11
  if (a === C.GL) return NONE; // LB12
  if (b === C.GL && a !== C.SP && a !== C.BA && a !== C.HY && a !== C.HH) return NONE; // LB12a
  if (b === C.CL || b === C.CP || b === C.EX || b === C.SY) return NONE; // LB13
  if (beforeSpaces === C.OP) return NONE; // LB14
  if (beforeSpaces === C.QU && hasFlag(g, s, FLAG_INITIAL_PUNCTUATION)) {
    const p = classAt(g, s - 1); // LB15a
    if (QUOTE_OPENERS.has(p)) return NONE;
  }
  if (b === C.QU && hasFlag(g, k, FLAG_FINAL_PUNCTUATION)) {
    const n = classAt(g, k + 1); // LB15b
    if (QUOTE_CLOSERS.has(n)) return NONE;
  }
  if (a === C.SP && b === C.IS && classAt(g, k + 1) === C.NU) return BREAK; // LB15c
  if (b === C.IS) return NONE; // LB15d
  if (b === C.NS && (beforeSpaces === C.CL || beforeSpaces === C.CP)) return NONE; // LB16
  if (b === C.B2 && beforeSpaces === C.B2) return NONE; // LB17
  if (a === C.SP) return BREAK; // LB18
  if (b === C.QU && !hasFlag(g, k, FLAG_INITIAL_PUNCTUATION)) return NONE; // LB19
  if (a === C.QU && !hasFlag(g, k - 1, FLAG_FINAL_PUNCTUATION)) return NONE;
  if (b === C.QU && (!isEastAsianAt(g, k - 1) || !isEastAsianAt(g, k + 1))) return NONE; // LB19a
  if (a === C.QU && (!isEastAsianAt(g, k) || !isEastAsianAt(g, k - 2))) return NONE;
  if (a === C.CB || b === C.CB) return BREAK; // LB20
  if ((a === C.HY || a === C.HH) && (b === C.AL || b === C.HL)) {
    const p = classAt(g, k - 2); // LB20a
    if (HYPHEN_STARTERS.has(p)) return NONE;
  }
  if (b === C.BA || b === C.HH || b === C.HY || b === C.NS || a === C.BB) return NONE; // LB21
  if ((a === C.HY || a === C.HH) && classAt(g, k - 2) === C.HL && b !== C.HL) return NONE; // LB21a
  if (a === C.SY && b === C.HL) return NONE; // LB21b
  if (b === C.IN) return NONE; // LB22
  return numericAndLetterRule(g, k, a, b);
}

/**
 * Whether a class is a letter (AL or HL).
 *
 * @param value - A class.
 * @returns Whether it is.
 */
function isLetter(value: number): boolean {
  return value === C.AL || value === C.HL;
}

/**
 * Whether a class is ideographic for LB23a (ID, EB or EM).
 *
 * @param value - A class.
 * @returns Whether it is.
 */
function isIdeographic(value: number): boolean {
  return value === C.ID || value === C.EB || value === C.EM;
}

/**
 * Whether a class is a numeric prefix or postfix (PR or PO).
 *
 * @param value - A class.
 * @returns Whether it is.
 */
function isAffix(value: number): boolean {
  return value === C.PR || value === C.PO;
}

/**
 * Whether a class is a Korean jamo or syllable (JL, JV, JT, H2 or H3).
 *
 * @param value - A class.
 * @returns Whether it is.
 */
function isJamo(value: number): boolean {
  return value === C.JL || value === C.JV || value === C.JT || value === C.H2 || value === C.H3;
}

/**
 * Whether a group is an aksara for LB28a: AK, AS or the dotted circle.
 *
 * @param g - The groups.
 * @param at - The group.
 * @returns Whether it is.
 */
function isAksara(g: Groups, at: number): boolean {
  const value = classAt(g, at);
  return value === C.AK || value === C.AS || g.codepoints[at] === DOTTED_CIRCLE;
}

/**
 * Whether a group is an aksara base for LB28a: AK or the dotted circle.
 *
 * @param g - The groups.
 * @param at - The group.
 * @returns Whether it is.
 */
function isAksaraBase(g: Groups, at: number): boolean {
  return classAt(g, at) === C.AK || g.codepoints[at] === DOTTED_CIRCLE;
}

/**
 * Decides a boundary by LB23–LB31, after the earlier rules have passed it.
 *
 * @param g - The groups.
 * @param k - The group after the boundary.
 * @param a - The class before it.
 * @param b - The class after it.
 * @returns NONE or BREAK.
 */
function numericAndLetterRule(g: Groups, k: number, a: number, b: number): number {
  if ((isLetter(a) && b === C.NU) || (a === C.NU && isLetter(b))) return NONE; // LB23
  if ((a === C.PR && isIdeographic(b)) || (isIdeographic(a) && b === C.PO)) return NONE; // LB23a
  if ((isAffix(a) && isLetter(b)) || (isLetter(a) && isAffix(b))) return NONE; // LB24
  // LB25: NU (SY | IS)* (CL | CP)? × (PO | PR), and NU (SY | IS)* × NU.
  if (isAffix(b) || b === C.NU) {
    let j = k - 1;
    if (isAffix(b) && (classAt(g, j) === C.CL || classAt(g, j) === C.CP)) j -= 1;
    while (classAt(g, j) === C.SY || classAt(g, j) === C.IS) j -= 1;
    if (classAt(g, j) === C.NU) return NONE;
  }
  if (isAffix(a) && b === C.OP) {
    const n = classAt(g, k + 1);
    if (n === C.NU || (n === C.IS && classAt(g, k + 2) === C.NU)) return NONE;
  }
  if ((isAffix(a) || a === C.HY || a === C.IS) && b === C.NU) return NONE;
  // LB26, LB27: Korean syllable blocks.
  if (a === C.JL && (b === C.JL || b === C.JV || b === C.H2 || b === C.H3)) return NONE;
  if ((a === C.JV || a === C.H2) && (b === C.JV || b === C.JT)) return NONE;
  if ((a === C.JT || a === C.H3) && b === C.JT) return NONE;
  if ((isJamo(a) && b === C.PO) || (a === C.PR && isJamo(b))) return NONE;
  if (isLetter(a) && isLetter(b)) return NONE; // LB28
  // LB28a: Brahmic orthographic syllables.
  if (a === C.AP && isAksara(g, k)) return NONE;
  if (isAksara(g, k - 1) && (b === C.VF || b === C.VI)) return NONE;
  if (a === C.VI && isAksara(g, k - 2) && isAksaraBase(g, k)) return NONE;
  if (isAksara(g, k - 1) && isAksara(g, k) && classAt(g, k + 1) === C.VF) return NONE;
  if (a === C.IS && isLetter(b)) return NONE; // LB29
  // LB30: letters and numbers against non-East-Asian parentheses.
  if ((isLetter(a) || a === C.NU) && b === C.OP && !isEastAsianAt(g, k)) return NONE;
  if (a === C.CP && !isEastAsianAt(g, k - 1) && (isLetter(b) || b === C.NU)) return NONE;
  if (a === C.RI && b === C.RI) {
    // LB30a: regional indicators pair up; an odd run before the boundary keeps the next one.
    if (elementAt(g.indicatorRun, k - 1) % 2 === 1) return NONE;
  }
  const isPotentialBase =
    (elementAt(g.values, k - 1) & FLAG_EXTENDED_PICTOGRAPHIC_UNASSIGNED) !== 0;
  if (b === C.EM && (a === C.EB || isPotentialBase)) return NONE; // LB30b
  return BREAK; // LB31
}
