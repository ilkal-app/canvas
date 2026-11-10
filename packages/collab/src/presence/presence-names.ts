import { MAX_PRESENCE_TEXT_LENGTH } from './presence-limits.js';

/**
 * The characters a display name loses: C0 and C1 controls (`\p{Cc}`, DEL included), the line and
 * paragraph separators U+2028 and U+2029, and the bidi controls (U+202A to U+202E, U+2066 to
 * U+2069, U+200E, U+200F, U+061C) that can reorder the text around a name. A peer chooses its
 * name, and it is drawn beside its cursor and shown in a tooltip on every client.
 */
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/gu;

/** How many times the bound the grapheme walk looks at; a longer cluster is cut inside. */
const GRAPHEME_WINDOW = 4;

/** Splits text into user-perceived characters, where the runtime can. */
const SEGMENTER: Intl.Segmenter | undefined =
  'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

/**
 * Cuts a text to at most `max` UTF-16 units at a code point boundary: a high surrogate at the
 * cut is dropped with its missing pair.
 *
 * @param text - The text.
 * @param max - The most units.
 * @returns The text, or its start.
 */
function cutAtCodePoint(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * Cuts a text to at most `max` UTF-16 units, never inside a surrogate pair and, when a
 * segmenter is given, never inside a grapheme cluster (an emoji with a skin tone, a family, a
 * letter with its accents): a cluster that does not fit is dropped whole. A cluster longer
 * than the bound, all of it combining marks, is cut at a code point instead of leaving nothing.
 * Only the first few times the bound is segmented, so a 5 MB text costs nothing.
 *
 * @param text - The text.
 * @param max - The most UTF-16 units to keep.
 * @param segmenter - A grapheme segmenter, or `undefined` for a cut at a code point.
 * @returns The text, or its start.
 */
export function clampAtBoundary(
  text: string,
  max: number,
  segmenter: Intl.Segmenter | undefined,
): string {
  if (text.length <= max) return text;
  const cut = cutAtCodePoint(text, max);
  if (segmenter === undefined) return cut;
  const window = cutAtCodePoint(text, max * GRAPHEME_WINDOW);
  let end = 0;
  for (const { segment } of segmenter.segment(window)) {
    if (end + segment.length > max) break;
    end += segment.length;
  }
  return end === 0 ? cut : window.slice(0, end);
}

/**
 * A display name as presence shows it: without controls, line separators and bidi controls, and
 * at most {@link MAX_PRESENCE_TEXT_LENGTH} units long, cut at a grapheme boundary where the
 * runtime can segment and at a code point otherwise. May be empty.
 *
 * @param name - The name a client or a peer chose.
 * @returns The name to show.
 */
export function cleanPresenceName(name: string): string {
  return clampAtBoundary(
    name.replace(UNSAFE_NAME_CHARACTERS, ''),
    MAX_PRESENCE_TEXT_LENGTH,
    SEGMENTER,
  );
}
