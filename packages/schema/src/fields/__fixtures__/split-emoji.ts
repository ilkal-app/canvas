import type { TextContent } from '../text-content.js';
import type { TextStyle } from '../text-style.js';

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};
const BOLD: TextStyle = { ...BODY, weight: 700 };

/** The fixture board's sticky text; the emoji is the surrogate pair at code units 14 and 15. */
export const EMOJI_TEXT = 'Ship the beta 😀';

/**
 * The emoji text with its second run starting at code unit 15, between the two halves of the
 * emoji's surrogate pair: the run lengths sum correctly, but the boundary splits a character.
 *
 * @returns Fresh text and runs.
 */
export function splitEmojiContent(): TextContent {
  return {
    text: EMOJI_TEXT,
    runs: [
      { length: 15, style: BODY },
      { length: 1, style: BOLD },
    ],
  };
}

/**
 * The emoji text with the same two styles, the boundary at code unit 14, before the emoji: a
 * valid restyle of the whole character.
 *
 * @returns Fresh text and runs.
 */
export function wholeEmojiContent(): TextContent {
  return {
    text: EMOJI_TEXT,
    runs: [
      { length: 14, style: BODY },
      { length: 2, style: BOLD },
    ],
  };
}
