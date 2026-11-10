/**
 * The most text the hidden input mirrors, UTF-16 code units: all of a shorter text, else a window
 * this long around the caret, so a long text never costs a long write per keystroke.
 */
export const MIRROR_WINDOW_LENGTH = 2_000;

/** The part of the edited text the hidden input holds. */
export interface TextMirror {
  /** Where the window starts in the text, UTF-16 code units. */
  readonly offset: number;
  /** The window's characters: the input's value. */
  readonly value: string;
  /** The selection's start in the window (the input's `selectionStart`). */
  readonly selectionStart: number;
  /** The selection's end in the window (the input's `selectionEnd`). */
  readonly selectionEnd: number;
  /** `backward` when the caret is at the selection's start. */
  readonly direction: 'forward' | 'backward';
}

/** An edit the input made to its value, in the window's coordinates. */
export interface MirrorEdit {
  /** The replaced range's start. */
  readonly start: number;
  /** The replaced range's end. */
  readonly end: number;
  /** What replaced it; empty for a delete. */
  readonly text: string;
}

/**
 * Whether a UTF-16 index falls inside a surrogate pair (between its two halves).
 *
 * @param text - The text.
 * @param index - The index.
 * @returns True when the unit before is a high surrogate and the one at is a low surrogate.
 */
function isInsidePair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
}

/**
 * The window of a text the hidden input mirrors (a screen reader reads the text, the caret
 * and the selection there): the whole text when it fits in `length`, else `length` units around the
 * selection (the selection whole if longer), never splitting a surrogate pair. Pure.
 *
 * @param text - The edited text.
 * @param caret - The caret, UTF-16 code units.
 * @param anchor - The selection's other end (the caret when collapsed).
 * @param length - The window's length; {@link MIRROR_WINDOW_LENGTH} by default.
 * @returns The window with the selection in its coordinates.
 */
export function mirrorOf(
  text: string,
  caret: number,
  anchor: number,
  length: number = MIRROR_WINDOW_LENGTH,
): TextMirror {
  const start = Math.min(caret, anchor);
  const end = Math.max(caret, anchor);
  let offset = 0;
  let windowEnd = text.length;
  if (text.length > length) {
    offset = Math.max(0, Math.min(start - Math.floor(length / 2), text.length - length));
    windowEnd = Math.min(text.length, Math.max(offset + length, end));
    if (isInsidePair(text, offset)) offset -= 1;
    if (isInsidePair(text, windowEnd)) windowEnd += 1;
  }
  return {
    offset,
    value: text.slice(offset, windowEnd),
    selectionStart: start - offset,
    selectionEnd: end - offset,
    direction: caret < anchor ? 'backward' : 'forward',
  };
}

/**
 * Finds the edit an input made to the value it mirrored, when the browser gave no usable
 * `beforeinput` (an Android keyboard's delete, an autocorrection): the common prefix and suffix
 * of the two values, the prefix no longer than the old selection's start and the suffix no
 * longer than what follows the old selection's end and the new caret, so a repeated character
 * is placed where the caret was; never splitting a surrogate pair. Pure.
 *
 * @param before - The mirror the input held.
 * @param value - The input's value now.
 * @param caret - The input's caret now (`selectionEnd`).
 * @returns The edit, or `undefined` when the values are the same.
 */
export function mirrorEditOf(
  before: TextMirror,
  value: string,
  caret: number,
): MirrorEdit | undefined {
  const old = before.value;
  if (old === value) return undefined;
  const maxPrefix = Math.min(old.length, value.length, before.selectionStart);
  let prefix = 0;
  while (prefix < maxPrefix && old[prefix] === value[prefix]) prefix += 1;
  const maxSuffix = Math.max(
    0,
    Math.min(
      old.length - prefix,
      value.length - prefix,
      old.length - before.selectionEnd,
      value.length - caret,
    ),
  );
  let suffix = 0;
  while (suffix < maxSuffix && old[old.length - 1 - suffix] === value[value.length - 1 - suffix]) {
    suffix += 1;
  }
  if (prefix > 0 && isInsidePair(old, prefix)) prefix -= 1;
  if (suffix > 0 && isInsidePair(old, old.length - suffix)) suffix -= 1;
  return {
    start: prefix,
    end: old.length - suffix,
    text: value.slice(prefix, value.length - suffix),
  };
}
