// Rule P1 of the Unicode bidirectional algorithm: a text's paragraphs, each ending
// after its paragraph separator (Bidi_Class B), CR LF counting as one.

import { codepointAt } from '../layout/codepoints.js';

import { bidiClassIndexOf } from './bidi-class.js';
import { K } from './bidi-explicit.js';

const CR = 0x0d;
const LF = 0x0a;

/** A paragraph of a text: a UTF-16 range. */
export interface ParagraphRange {
  /** Its first UTF-16 index. */
  readonly start: number;
  /** One past its last, after its paragraph separator if it has one. */
  readonly end: number;
}

/**
 * The paragraphs of a text: UTF-16 ranges, each ending after its paragraph separator (LF, CR,
 * CR LF, NEL, PS, and the other Bidi_Class B characters) or at the text's end. An empty text has
 * one empty paragraph; a separator at the end starts none after it.
 *
 * @param text - The text.
 * @returns The paragraphs, in order.
 */
export function splitParagraphs(text: string): ParagraphRange[] {
  const paragraphs: { start: number; end: number }[] = [];
  let start = 0;
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    index += length;
    if (bidiClassIndexOf(codepoint) !== K.B) continue;
    if (codepoint === CR && text.charCodeAt(index) === LF) index += 1;
    paragraphs.push({ start, end: index });
    start = index;
  }
  if (start < text.length || paragraphs.length === 0) paragraphs.push({ start, end: text.length });
  return paragraphs;
}
