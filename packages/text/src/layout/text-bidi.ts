// A text's bidi levels for layout: each paragraph's embedding levels by the Unicode
// bidirectional algorithm, in the text's base direction, or, when that is `auto`, its first
// strong character's. A text with no right-to-left or explicit bidi content that is not set right
// to left has none, and lays out left to right as before.

import { bidiClassIndexOf, BIDI_CLASSES } from '../bidi/bidi-class.js';
import { resolveParagraphLevels } from '../bidi/bidi-levels.js';
import { splitParagraphs } from '../bidi/split-paragraphs.js';
import { elementAt } from '../line-break/element-at.js';

import { codepointAt } from './codepoints.js';
import type { TextBaseDirection } from './text-layout.js';

/** A text's bidi levels. */
export interface TextBidi {
  /** Each UTF-16 index's embedding level, before L1; a character X9 removes takes the one before. */
  readonly levels: Uint8Array;
  /** Each UTF-16 index's paragraph embedding level, 0 or 1. */
  readonly paragraphLevels: Uint8Array;
}

/** The classes that make a text need the algorithm: right-to-left, Arabic numbers, formatting. */
const BIDI_TRIGGERS = new Set(
  ['R', 'AL', 'AN', 'LRE', 'RLE', 'LRO', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'].map((name) =>
    BIDI_CLASSES.indexOf(name as (typeof BIDI_CLASSES)[number]),
  ),
);

/** The first codepoint that can be right to left: Hebrew begins at U+0590. */
const FIRST_RIGHT_TO_LEFT = 0x0590;

/**
 * Whether a text has any character the bidi algorithm would order or embed differently from
 * left-to-right text.
 *
 * @param text - The text.
 * @returns Whether it has.
 */
function needsBidi(text: string): boolean {
  for (let index = 0; index < text.length;) {
    const unit = text.charCodeAt(index);
    if (unit < FIRST_RIGHT_TO_LEFT) {
      index += 1;
      continue;
    }
    const { codepoint, length } = codepointAt(text, index);
    if (BIDI_TRIGGERS.has(bidiClassIndexOf(codepoint))) return true;
    index += length;
  }
  return false;
}

/** The level a character removed by rule X9 reports. */
const REMOVED = 255;

/**
 * A text's bidi levels, paragraph by paragraph, or `undefined` for a text that is left to right
 * throughout.
 *
 * @param text - The text.
 * @param direction - Its base direction. Default `auto`.
 * @returns The levels, or `undefined`.
 */
export function textBidi(
  text: string,
  direction: TextBaseDirection = 'auto',
): TextBidi | undefined {
  if (direction !== 'rtl' && !needsBidi(text)) return undefined;
  const levels = new Uint8Array(text.length);
  const paragraphLevels = new Uint8Array(text.length);
  for (const { start, end } of splitParagraphs(text)) {
    const paragraph = resolveParagraphLevels(text.slice(start, end), direction);
    paragraphLevels.fill(paragraph.level, start, end);
    let previous = paragraph.level;
    for (let index = start; index < end; index += 1) {
      const level = elementAt(paragraph.levels, index - start);
      previous = level === REMOVED ? previous : level;
      levels[index] = previous;
    }
  }
  return { levels, paragraphLevels };
}

/**
 * The direction a text's first paragraph takes when its own is `auto`: right to left when its
 * first strong character (Unicode bidi rules P2 and P3) is, else left to right.
 *
 * @param text - The text.
 * @returns `rtl` or `ltr`.
 */
export function autoDirectionOf(text: string): 'ltr' | 'rtl' {
  if (!needsBidi(text)) return 'ltr';
  // A text has at least one paragraph.
  const first = elementAt(splitParagraphs(text), 0);
  const { level } = resolveParagraphLevels(text.slice(first.start, first.end), 'auto');
  return level % 2 === 1 ? 'rtl' : 'ltr';
}
