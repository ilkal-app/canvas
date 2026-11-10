/**
 * Tells whether a position in a string lies between two characters rather than between the two
 * halves of a surrogate pair. A character here is a Unicode code point, the unit Yjs `Y.Text`
 * keeps whole: Yjs stores each inserted or formatted stretch as its own string and encodes a
 * lone surrogate as U+FFFD, so an edit or a style-run boundary inside a pair would corrupt the
 * character on every peer. Grapheme clusters (an emoji ZWJ sequence, a letter with combining
 * marks) are not the unit: a boundary between their code points is allowed (see the package
 * README, "Text").
 *
 * @param text - The string, as JavaScript (UTF-16) code units.
 * @param index - The position, in UTF-16 code units; positions at or beyond either end count as
 *   boundaries.
 * @returns `false` exactly when `index` falls between a high surrogate (0xD800 to 0xDBFF) and
 *   the low surrogate (0xDC00 to 0xDFFF) that follows it.
 */
export function isCharacterBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
