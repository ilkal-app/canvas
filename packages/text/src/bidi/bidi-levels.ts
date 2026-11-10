// The Unicode bidirectional algorithm (UAX #9, revision 51, Unicode 17.0.0): a
// paragraph's embedding levels (P2–P3, X1–X10, W1–W7, N0–N2, I1–I2), a line's levels after L1, and
// the visual order L2 gives them.

import { codepointAt } from '../layout/codepoints.js';
import { elementAt } from '../line-break/element-at.js';

import { bidiClassIndexOf, type BidiClass } from './bidi-class.js';
import {
  explicitLevels,
  firstStrongLevel,
  isIsolateInitiator,
  isolatingRunSequences,
  isRemovedByX9,
  K,
  matchIsolates,
  REMOVED,
} from './bidi-explicit.js';
import { resolveSequence } from './bidi-implicit.js';

/** A paragraph's direction: left to right, right to left, or by its first strong character. */
export type ParagraphDirection = 'ltr' | 'rtl' | 'auto';

/** A paragraph's resolved embedding levels, before L1. */
export interface BidiParagraphLevels {
  /** The paragraph embedding level: 0 or 1 (`auto` resolves by P2 and P3, else 0). */
  readonly level: number;
  /**
   * One level per entry: per UTF-16 code unit from `resolveParagraphLevels` (both units of a
   * surrogate pair share it), per class from `resolveLevelsFromClasses`. 255 marks a character
   * X9 removes (embeddings, overrides, PDF, BN).
   */
  readonly levels: Uint8Array;
}

/**
 * Resolves levels from class indices.
 *
 * @param types - The classes, one per character.
 * @param codepoints - The characters, for bracket pairs (0 for none).
 * @param direction - The paragraph's direction.
 * @returns The paragraph level and a level per character.
 */
function resolve(
  types: Uint8Array,
  codepoints: ArrayLike<number>,
  direction: ParagraphDirection,
): { level: number; levels: Uint8Array } {
  const isolates = matchIsolates(types);
  const level =
    direction === 'ltr'
      ? 0
      : direction === 'rtl'
        ? 1
        : (firstStrongLevel(types, 0, types.length, isolates.pdiOf) ?? 0);
  const { levels, classes } = explicitLevels(types, level, isolates.pdiOf);
  for (const sequence of isolatingRunSequences(types, levels, level, isolates)) {
    resolveSequence(sequence, classes, levels, codepoints, types);
  }
  for (let index = 0; index < types.length; index += 1) {
    if (isRemovedByX9(elementAt(types, index))) levels[index] = REMOVED;
  }
  return { level, levels };
}

/**
 * A paragraph's embedding levels, by the Unicode bidirectional algorithm.
 *
 * @param text - One paragraph: no paragraph separator but, possibly, one at its end.
 * @param direction - Its direction; `auto` (the default) takes its first strong character's.
 * @returns The paragraph level, and a level per UTF-16 code unit.
 */
export function resolveParagraphLevels(
  text: string,
  direction: ParagraphDirection = 'auto',
): BidiParagraphLevels {
  const codepoints: number[] = [];
  const starts: number[] = [];
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    codepoints.push(codepoint);
    starts.push(index);
    index += length;
  }
  const types = Uint8Array.from(codepoints, (codepoint) => bidiClassIndexOf(codepoint));
  const resolved = resolve(types, codepoints, direction);
  const levels = new Uint8Array(text.length);
  for (const [character, start] of starts.entries()) {
    const end = starts[character + 1] ?? text.length;
    levels.fill(elementAt(resolved.levels, character), start, end);
  }
  return { level: resolved.level, levels };
}

/**
 * A paragraph's embedding levels from Bidi_Class values (one per character, no brackets), as
 * Unicode's BidiTest.txt gives its cases.
 *
 * @param classes - The classes.
 * @param direction - The paragraph's direction.
 * @returns The paragraph level, and a level per class.
 */
export function resolveLevelsFromClasses(
  classes: readonly BidiClass[],
  direction: ParagraphDirection,
): BidiParagraphLevels {
  const types = Uint8Array.from(classes, (name) => K[name]);
  return resolve(types, new Uint8Array(classes.length), direction);
}

/**
 * Rule L1 for one line: its levels, with segment and paragraph separators, and the whitespace and
 * isolate formatting characters before them and at the line's end, reset to the paragraph level.
 * Characters X9 removed keep their 255 and are passed over.
 *
 * @param levels - The line's levels.
 * @param classes - Each entry's original Bidi_Class.
 * @param paragraphLevel - The paragraph embedding level.
 * @returns The line's levels after L1.
 */
export function lineLevels(
  levels: ArrayLike<number>,
  classes: readonly BidiClass[],
  paragraphLevel: number,
): Uint8Array {
  const result = Uint8Array.from(levels);
  let isTrailing = true;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const type = K[elementAt(classes, index)];
    if (type === K.B || type === K.S) {
      result[index] = paragraphLevel;
      isTrailing = true;
    } else if (isTrailing && (type === K.WS || type === K.PDI || isIsolateInitiator(type))) {
      result[index] = paragraphLevel;
    } else if (!(isTrailing && isRemovedByX9(type))) isTrailing = false;
  }
  return result;
}

/**
 * Rule L2: a line's entries in visual order, left to right, entries at level 255 left out.
 *
 * @param levels - The line's levels, after L1.
 * @returns The logical indices, in visual order.
 */
export function visualOrder(levels: ArrayLike<number>): number[] {
  const order: number[] = [];
  let highest = 0;
  let lowestOdd = 255;
  for (let index = 0; index < levels.length; index += 1) {
    const level = elementAt(levels, index);
    if (level === REMOVED) continue;
    order.push(index);
    highest = Math.max(highest, level);
    if (level % 2 === 1) lowestOdd = Math.min(lowestOdd, level);
  }
  const levelAt = (position: number): number => elementAt(levels, elementAt(order, position));
  for (let level = highest; level >= lowestOdd && level > 0; level -= 1) {
    for (let start = 0; start < order.length;) {
      if (levelAt(start) < level) {
        start += 1;
        continue;
      }
      let end = start;
      while (end < order.length && levelAt(end) >= level) end += 1;
      for (let left = start, right = end - 1; left < right; left += 1, right -= 1) {
        const swapped = elementAt(order, left);
        order[left] = elementAt(order, right);
        order[right] = swapped;
      }
      start = end;
    }
  }
  return order;
}
