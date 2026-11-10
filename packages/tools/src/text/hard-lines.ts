// Hard lines read from the text alone: what Home, End, Up and Down follow while a
// face the text needs is still loading and there is no layout to go by. Every UAX #14 line
// terminator breaks a line, as layout breaks it: LF, CR LF (one break), CR, NEL, VT, FF, LS, PS.

/** The line terminators UAX #14 breaks a line at; CR LF is one break. */
const TERMINATORS = new Set(['\n', '\r', '\u0085', '\v', '\f', ' ', ' ']);

/**
 * The hard line around a caret index: from after the line break before it to the next line
 * break, the break itself excluded. An index inside CR LF belongs to the line before the CR. Pure.
 *
 * @param text - The text.
 * @param index - A caret index.
 * @returns `[start, end]` of the line.
 */
export function hardLineAt(text: string, index: number): readonly [start: number, end: number] {
  const isInsideCrLf = text[index - 1] === '\r' && text[index] === '\n';
  const at = isInsideCrLf ? index - 1 : index;
  let start = at;
  while (start > 0 && !TERMINATORS.has(text.charAt(start - 1))) start -= 1;
  let end = at;
  while (end < text.length && !TERMINATORS.has(text.charAt(end))) end += 1;
  return [start, end];
}

/**
 * The caret index one hard line up or down at the same offset from the line's start, clamped to
 * that line's end; from the first line up the text's start, from the last down its end. Pure.
 *
 * @param text - The text.
 * @param index - The caret index.
 * @param direction - −1 up, 1 down.
 * @returns The new caret index.
 */
export function hardLineStep(text: string, index: number, direction: -1 | 1): number {
  const [start, end] = hardLineAt(text, index);
  const column = Math.min(index, end) - start;
  if (direction < 0 && start === 0) return 0;
  if (direction > 0 && end === text.length) return text.length;
  // The neighbouring line, by a position on it: before this line's break, after its own.
  const breakLength = text.startsWith('\r\n', end) ? 2 : 1;
  const [nextStart, nextEnd] = hardLineAt(text, direction < 0 ? start - 1 : end + breakLength);
  return Math.min(nextStart + column, nextEnd);
}
