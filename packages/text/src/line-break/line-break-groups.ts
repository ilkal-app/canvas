// The groups the Unicode line breaking algorithm decides boundaries between (UAX #14):
// each character with the combining marks and joiners after it (LB9), its class resolved by LB1
// and LB10, held as parallel typed arrays.

import { codepointAt } from '../layout/codepoints.js';

import { elementAt } from './element-at.js';
import {
  FLAG_SPACING_OR_NONSPACING_MARK,
  isEastAsianValue,
  LINE_BREAK_CLASSES,
  lineBreakValueOf,
  type LineBreakClass,
} from './line-break-class.js';

/** Each class's index in the table, by name. */
export const C = Object.fromEntries(
  LINE_BREAK_CLASSES.map((name, index) => [name, index]),
) as Record<LineBreakClass, number>;

/** The packed value of U+0041, whose properties LB10 gives a lone combining mark. */
const LETTER_A_VALUE = lineBreakValueOf(0x41);
/** U+25CC DOTTED CIRCLE, which LB28a treats as an aksara. */
export const DOTTED_CIRCLE = 0x25cc;

/** No break before a group. */
export const NONE = 0;
/** A break opportunity before a group. */
export const BREAK = 1;
/** A mandatory break before a group. */
export const MANDATORY = 2;

/** The groups LB9 forms, as parallel arrays. */
export interface Groups {
  /** The group's class, resolved by LB1 and LB10. */
  readonly classes: Uint8Array;
  /** Its base character's packed value. */
  readonly values: Uint16Array;
  /** Its base character. */
  readonly codepoints: Int32Array;
  /** Its first UTF-16 index. */
  readonly starts: Int32Array;
  /** Whether it ends with a zero width joiner (LB8a). */
  readonly endsWithJoiner: Uint8Array;
  /** Whether its base character's class is SA. */
  readonly isComplex: Uint8Array;
  /** How many regional indicators end at this group, itself included (LB30a); 0 when it is not one. */
  readonly indicatorRun: Int32Array;
  count: number;
}

/** Each class as LB1 resolves it, but SA (which depends on the character): AI, SG, XX as AL, CJ as NS. */
const RESOLVED = Uint8Array.from(LINE_BREAK_CLASSES, (name) => {
  if (name === 'AI' || name === 'SG' || name === 'XX') return C.AL;
  return name === 'CJ' ? C.NS : C[name];
});

/**
 * A class as LB1 resolves it: AI, SG and XX as AL, SA as CM for a mark and AL otherwise, CJ as NS.
 *
 * @param value - The character's packed value.
 * @returns The resolved class's index.
 */
function resolvedClass(value: number): number {
  const index = value & 0x3f;
  if (index === C.SA) return (value & FLAG_SPACING_OR_NONSPACING_MARK) !== 0 ? C.CM : C.AL;
  return elementAt(RESOLVED, index);
}

/**
 * A group's class.
 *
 * @param g - The groups.
 * @param at - The group.
 * @returns Its class, or -1 before the first or after the last (sot, eot).
 */
export function classAt(g: Groups, at: number): number {
  return at >= 0 && at < g.count ? elementAt(g.classes, at) : -1;
}

/**
 * Whether a group's base character has a flag.
 *
 * @param g - The groups.
 * @param at - The group.
 * @param flag - The flag.
 * @returns Whether it has.
 */
export function hasFlag(g: Groups, at: number, flag: number): boolean {
  return (elementAt(g.values, at) & flag) !== 0;
}

/**
 * Whether a group's base character is Fullwidth, Wide or Halfwidth: UAX #14's `$EastAsian`.
 *
 * @param g - The groups.
 * @param at - The group.
 * @returns Whether it is; false outside the text.
 */
export function isEastAsianAt(g: Groups, at: number): boolean {
  return at >= 0 && at < g.count && isEastAsianValue(elementAt(g.values, at));
}

/** The classes a combining mark does not attach to (LB9). */
const NOT_A_BASE = new Set([C.BK, C.CR, C.LF, C.NL, C.SP, C.ZW]);

/**
 * Groups the text's characters as LB9 and LB10 say.
 *
 * @param text - The text.
 * @returns The groups.
 */
export function groupsOf(text: string): Groups {
  const capacity = text.length;
  const groups: Groups = {
    classes: new Uint8Array(capacity),
    values: new Uint16Array(capacity),
    codepoints: new Int32Array(capacity),
    starts: new Int32Array(capacity),
    endsWithJoiner: new Uint8Array(capacity),
    isComplex: new Uint8Array(capacity),
    indicatorRun: new Int32Array(capacity),
    count: 0,
  };
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    const value = lineBreakValueOf(codepoint);
    const resolved = resolvedClass(value);
    const isJoiner = resolved === C.ZWJ;
    const last = groups.count - 1;
    if (resolved === C.CM || isJoiner) {
      if (last >= 0 && !NOT_A_BASE.has(elementAt(groups.classes, last))) {
        // LB9: the mark joins the group before it, which keeps its class.
        groups.endsWithJoiner[last] = isJoiner ? 1 : 0;
        index += length;
        continue;
      }
    }
    const at = groups.count;
    const isLoneMark = resolved === C.CM || isJoiner;
    groups.classes[at] = isLoneMark ? C.AL : resolved;
    groups.values[at] = isLoneMark ? LETTER_A_VALUE : value;
    groups.codepoints[at] = codepoint;
    groups.starts[at] = index;
    groups.endsWithJoiner[at] = isJoiner ? 1 : 0;
    groups.isComplex[at] = (value & 0x3f) === C.SA ? 1 : 0;
    groups.indicatorRun[at] =
      groups.classes[at] === C.RI ? (groups.indicatorRun[at - 1] ?? 0) + 1 : 0;
    groups.count += 1;
    index += length;
  }
  return groups;
}
