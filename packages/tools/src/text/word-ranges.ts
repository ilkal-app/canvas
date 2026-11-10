import { snapToGrapheme } from './grapheme-steps.js';

/**
 * A word character where `Intl.Segmenter` is missing: a letter, a combining mark, a digit or an
 * underscore, in any script.
 */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

/**
 * What makes a segment a word whatever the segmenter says: a letter, a digit or an underscore. Not
 * a mark alone: an emoji's variation selector (❤️) and a combining mark after a space are marks,
 * and Chrome's segmenter calls them non-words.
 */
const WORD_SEGMENT_CHARACTER = /[\p{L}\p{N}_]/u;

/** The word segmenters made so far, by locale ('' for the default). */
const segmenters = new Map<string, Intl.Segmenter>();

/**
 * The word segmenter for a locale, made on first use: it finds words by the
 * language's dictionary where it has no spaces (Thai, Chinese, Japanese). An unknown locale gets
 * the default one.
 *
 * @param locale - A BCP 47 tag, or undefined for the default.
 * @returns The segmenter, or `null` where `Intl.Segmenter` is missing.
 */
function wordSegmenter(locale: string | undefined): Intl.Segmenter | null {
  if (!('Segmenter' in Intl)) return null;
  const key = locale ?? '';
  let found = segmenters.get(key);
  if (found === undefined) {
    try {
      found = new Intl.Segmenter(locale, { granularity: 'word' });
    } catch {
      found = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
    segmenters.set(key, found);
  }
  return found;
}

/**
 * Whether a segment is a word: the segmenter says so (`isWordLike`), or it holds a letter, a digit
 * or an underscore. Firefox's segmenter calls some words not word-like (the Devanagari 'नमस्ते',
 *) that Chrome's calls words; a segment of spaces, punctuation, emoji (with their
 * variation selectors) or a combining mark alone stays a non-word.
 *
 * @param segment - The segment's text.
 * @param isWordLike - The segmenter's `isWordLike`.
 * @returns Whether it is a word.
 */
function isWordSegment(segment: string, isWordLike: boolean | undefined): boolean {
  return isWordLike === true || WORD_SEGMENT_CHARACTER.test(segment);
}

/**
 * Whether a code unit is part of a word, where `Intl.Segmenter` is missing. Surrogate halves are
 * not, so a pair stays together in a run of other characters.
 *
 * @param character - One UTF-16 code unit, or undefined past an end.
 * @returns Whether it is a word character.
 */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/**
 * The start of the word before a position (mod or Alt with the left arrow): skips other
 * characters, then the word, as the locale finds words.
 *
 * @param text - The text.
 * @param index - The position.
 * @param locale - The text's language there, a BCP 47 tag; undefined for the default.
 * @returns The word's start.
 */
export function wordStartBefore(text: string, index: number, locale?: string): number {
  const segmenter = wordSegmenter(locale);
  if (segmenter !== null) {
    // The last word starting before the position: other characters skipped, then the word.
    // Segments are read lazily, only as far as the position.
    let start = 0;
    for (const { index: at, segment, isWordLike } of segmenter.segment(text)) {
      if (at >= index) break;
      if (isWordSegment(segment, isWordLike)) start = at;
    }
    return snapToGrapheme(text, start);
  }
  let position = index;
  while (position > 0 && !isWordCharacter(text[position - 1])) position -= 1;
  while (position > 0 && isWordCharacter(text[position - 1])) position -= 1;
  return snapToGrapheme(text, position);
}

/**
 * The end of the word after a position (mod or Alt with the right arrow).
 *
 * @param text - The text.
 * @param index - The position.
 * @param locale - The text's language there, a BCP 47 tag; undefined for the default.
 * @returns The word's end.
 */
export function wordEndAfter(text: string, index: number, locale?: string): number {
  const segmenter = wordSegmenter(locale);
  if (segmenter !== null) {
    // The first word ending after the position, read lazily up to it.
    for (const { index: at, segment, isWordLike } of segmenter.segment(text)) {
      const end = at + segment.length;
      if (isWordSegment(segment, isWordLike) && end > index) return snapToGrapheme(text, end, 1);
    }
    return text.length;
  }
  let position = index;
  while (position < text.length && !isWordCharacter(text[position])) position += 1;
  while (position < text.length && isWordCharacter(text[position])) position += 1;
  return snapToGrapheme(text, position, 1);
}

/**
 * The word, or run of other characters, containing a position, never across a newline (the
 * prototype's `wordRangeAt`): what a double-click selects. Words are as the locale finds them,
 * so a Thai or Chinese word is selected alone though no space ends it. Pure.
 *
 * @param text - The text.
 * @param index - The position; at the end, the last character's range.
 * @param locale - The text's language there, a BCP 47 tag; undefined for the default.
 * @returns `[start, end]`, between grapheme clusters.
 */
export function wordRangeAt(
  text: string,
  index: number,
  locale?: string,
): readonly [start: number, end: number] {
  const clamped = Math.max(0, Math.min(text.length, index));
  const probe = clamped < text.length ? clamped : clamped - 1;
  if (probe < 0) return [0, 0];
  const segmenter = wordSegmenter(locale);
  if (segmenter !== null) {
    // Read lazily, up to the probe's segment and, for a run of other characters, to its end: a
    // run joins the segments that are neither words nor hold a newline.
    let start = probe;
    let end = probe + 1;
    let runStart = 0;
    let isRun = false;
    for (const { index: at, segment, isWordLike } of segmenter.segment(text)) {
      const segmentEnd = at + segment.length;
      const isJoining = !isWordSegment(segment, isWordLike) && !segment.includes('\n');
      if (segmentEnd <= probe) {
        if (!isJoining) runStart = segmentEnd;
      } else if (at <= probe) {
        start = isJoining ? runStart : at;
        end = segmentEnd;
        isRun = isJoining;
        if (!isRun) break;
      } else {
        if (!isJoining) break;
        end = segmentEnd;
      }
    }
    return [snapToGrapheme(text, start), snapToGrapheme(text, end, 1)];
  }
  const isInWord = isWordCharacter(text[probe]);
  let start = probe;
  let end = probe + 1;
  while (start > 0 && isWordCharacter(text[start - 1]) === isInWord && text[start - 1] !== '\n') {
    start -= 1;
  }
  while (end < text.length && isWordCharacter(text[end]) === isInWord && text[end] !== '\n') {
    end += 1;
  }
  return [snapToGrapheme(text, start), snapToGrapheme(text, end, 1)];
}
