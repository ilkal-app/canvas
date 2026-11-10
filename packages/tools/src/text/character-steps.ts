/**
 * Whether a UTF-16 code unit is a high surrogate.
 *
 * @param code - The code unit.
 * @returns Whether it starts a pair.
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Whether a UTF-16 code unit is a low surrogate.
 *
 * @param code - The code unit.
 * @returns Whether it ends a pair.
 */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The position one code point before another, so a caret never lands inside a surrogate pair
 * (the prototype's `prevIndex`). Pure.
 *
 * @param text - The text.
 * @param index - A position, UTF-16 code units.
 * @returns The position before it; 0 at the start.
 */
export function previousCharacterIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const isPair =
    index >= 2 &&
    isLowSurrogate(text.charCodeAt(index - 1)) &&
    isHighSurrogate(text.charCodeAt(index - 2));
  return isPair ? index - 2 : index - 1;
}

/**
 * The position one code point after another (the prototype's `nextIndex`). Pure.
 *
 * @param text - The text.
 * @param index - A position, UTF-16 code units.
 * @returns The position after it; the text's length at the end.
 */
export function nextCharacterIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const isPair =
    index + 1 < text.length &&
    isHighSurrogate(text.charCodeAt(index)) &&
    isLowSurrogate(text.charCodeAt(index + 1));
  return isPair ? index + 2 : index + 1;
}

/**
 * Clamps a position to the text and moves one inside a surrogate pair back to the pair's
 * start, so it lies between code points. Pure.
 *
 * @param text - The text.
 * @param index - A position, UTF-16 code units.
 * @returns The nearest position at or before it between code points.
 */
export function snapToCharacter(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(text.length, index));
  const isInsidePair =
    clamped > 0 &&
    clamped < text.length &&
    isLowSurrogate(text.charCodeAt(clamped)) &&
    isHighSurrogate(text.charCodeAt(clamped - 1));
  return isInsidePair ? clamped - 1 : clamped;
}
