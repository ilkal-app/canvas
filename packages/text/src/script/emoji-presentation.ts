// Whether a grapheme cluster is drawn as emoji (UTS #51), which sends it to the emoji face
// ahead of the run's own face: a cluster asking for it with VS16, a flag, a skin-tone modifier
// sequence, or one starting with a character whose default presentation is emoji. Every fully
// qualified RGI ZWJ, tag and keycap sequence is one of these (its text-default elements carry
// VS16). VS15 asks for text, and a text-default character alone, or joined to another without
// VS16, stays text. The data is UCD 17.0.0 (emoji-data.ts),
// never the JavaScript engine's, so Node and every browser agree.

import { codepointAt } from '../layout/codepoints.js';
import { elementAt } from '../line-break/element-at.js';

import { EMOJI_MODIFIER_BASE_RANGES, EMOJI_PRESENTATION_RANGES } from './emoji-data.js';

/** VS15, the text presentation selector. */
const TEXT_SELECTOR = 0xfe0e;
/** VS16, the emoji presentation selector. */
const EMOJI_SELECTOR = 0xfe0f;

/** A property's ranges as sorted pairs of first and last codepoints. */
type Ranges = Uint32Array;

/**
 * Parses generated base-36 `first-last` ranges.
 *
 * @param data - The ranges, comma-separated.
 * @returns First and last of each, flattened.
 */
function parseRanges(data: string): Ranges {
  return Uint32Array.from(
    data.split(',').flatMap((range) => range.split('-').map((end) => Number.parseInt(end, 36))),
  );
}

let presentation: Ranges | undefined;
let modifierBase: Ranges | undefined;

/**
 * Whether a codepoint falls in one of a property's ranges.
 *
 * @param ranges - The ranges.
 * @param codepoint - The codepoint.
 * @returns True when it does.
 */
function inRanges(ranges: Ranges, codepoint: number): boolean {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (codepoint < elementAt(ranges, middle * 2)) high = middle - 1;
    else if (codepoint > elementAt(ranges, middle * 2 + 1)) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * A text's codepoints.
 *
 * @param text - The text.
 * @returns Its codepoints, in order.
 */
function codepointsOf(text: string): number[] {
  const points: number[] = [];
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    points.push(codepoint);
    index += length;
  }
  return points;
}

/**
 * Whether a codepoint's default presentation is emoji (Emoji_Presentation=Yes).
 *
 * @param codepoint - The codepoint.
 * @returns True when it is.
 */
export function hasEmojiPresentation(codepoint: number): boolean {
  presentation ??= parseRanges(EMOJI_PRESENTATION_RANGES);
  return inRanges(presentation, codepoint);
}

/**
 * Whether a skin-tone modifier after a codepoint makes an emoji modifier sequence
 * (Emoji_Modifier_Base=Yes).
 *
 * @param codepoint - The codepoint.
 * @returns True when it does.
 */
function isModifierBase(codepoint: number): boolean {
  modifierBase ??= parseRanges(EMOJI_MODIFIER_BASE_RANGES);
  return inRanges(modifierBase, codepoint);
}

/**
 * Whether a grapheme cluster is drawn as emoji: not when it carries VS15; when it carries VS16;
 * a pair of regional indicators (a flag), never one alone, which shows as a letter (UTS #51
 * annex B); a modifier base with a skin tone; else when its first character's default
 * presentation is emoji.
 *
 * @param cluster - One grapheme cluster's text.
 * @returns True when it is drawn as emoji.
 */
export function isEmojiPresentation(cluster: string): boolean {
  const points = codepointsOf(cluster);
  const [first, second] = points;
  if (first === undefined || points.includes(TEXT_SELECTOR)) return false;
  if (points.includes(EMOJI_SELECTOR)) return true;
  const isRegional = (point: number): boolean => point >= 0x1f1e6 && point <= 0x1f1ff;
  if (isRegional(first)) return second !== undefined && isRegional(second);
  const isModifier = (point: number): boolean => point >= 0x1f3fb && point <= 0x1f3ff;
  if (second !== undefined && isModifier(second) && isModifierBase(first)) return true;
  return hasEmojiPresentation(first);
}

/**
 * Whether a stretch of text may hold a cluster drawn as emoji: a superset test, cheap enough to
 * skip segmenting text that holds none (VS16 or an emoji-presentation character; every cluster
 * drawn as emoji holds one, a flag's and a skin tone's included).
 *
 * @param text - The text.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past its last.
 * @returns False only when no cluster of it is drawn as emoji.
 */
export function mayHoldEmoji(text: string, start: number, end: number): boolean {
  for (let index = start; index < end;) {
    const { codepoint, length } = codepointAt(text, index);
    if (codepoint === EMOJI_SELECTOR || hasEmojiPresentation(codepoint)) return true;
    index += length;
  }
  return false;
}
