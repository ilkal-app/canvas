/** One character of a string: its codepoint and how many UTF-16 code units it spans. */
export interface StringCharacter {
  /** The codepoint, or a lone surrogate's own code unit. */
  readonly codepoint: number;
  /** 2 for a surrogate pair, else 1. */
  readonly length: 1 | 2;
}

/**
 * Reads the codepoint starting at a UTF-16 index: a surrogate pair decodes to one codepoint,
 * and a lone surrogate is returned as itself (it draws as the font's missing glyph).
 *
 * @param text - The text.
 * @param index - A UTF-16 index inside the text.
 * @returns The codepoint and how many code units it spans (1 or 2).
 */
export function codepointAt(text: string, index: number): StringCharacter {
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) {
      return { codepoint: (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000, length: 2 };
    }
  }
  return { codepoint: high, length: 1 };
}

/** U+000A, the only character that ends a line. */
export const NEWLINE = 0x0a;

/** U+0020, the only character a line wraps after and the only one that hangs past the width. */
export const SPACE = 0x20;
