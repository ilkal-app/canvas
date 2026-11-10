import {
  caretPlacement,
  caretRect,
  indexAtLine,
  lineEndIndex,
  lineOf,
  visualCaretStep,
  type TextLayout,
} from '@canvas/engine';

import { hasSelection, selectionRange, type EditorState } from './editor-state.js';
import { nextGraphemeIndex, previousGraphemeIndex, snapToGrapheme } from './grapheme-steps.js';
import { hardLineAt, hardLineStep } from './hard-lines.js';
import { styleOfCharacter } from './runs/style-at.js';
import { wordEndAfter, wordRangeAt, wordStartBefore } from './word-ranges.js';

/**
 * The language of the character at an index, which finds the words there.
 *
 * @param state - The editor.
 * @param index - The character's index, clamped to the text.
 * @returns Its run's BCP 47 tag, if any; none for a state built without runs.
 */
function languageAt(state: EditorState, index: number): string | undefined {
  if (state.runs.length === 0) return undefined;
  return styleOfCharacter(state.runs, Math.max(0, Math.min(index, state.text.length - 1))).lang;
}

/** How far a horizontal caret move goes. */
export type CaretUnit = 'character' | 'word';

/**
 * Moves the caret, extending the selection or collapsing it there; any move clears the pending
 * style (the prototype's `setCaret`).
 *
 * @param state - The editor.
 * @param index - Where, UTF-16 code units; clamped to the text and snapped between grapheme clusters.
 * @param isExtending - Whether the anchor stays (Shift held, a drag).
 * @returns The new state.
 */
export function setCaret(state: EditorState, index: number, isExtending: boolean): EditorState {
  const caret = snapToGrapheme(state.text, index);
  return { ...state, caret, anchor: isExtending ? state.anchor : caret, pending: undefined };
}

/**
 * Selects a range, the caret at its end.
 *
 * @param state - The editor.
 * @param anchor - The fixed end.
 * @param caret - The caret.
 * @returns The new state.
 */
export function selectRange(state: EditorState, anchor: number, caret: number): EditorState {
  const text = state.text;
  return {
    ...state,
    anchor: snapToGrapheme(text, anchor),
    caret: snapToGrapheme(text, caret),
    pending: undefined,
  };
}

/**
 * Selects the whole text.
 *
 * @param state - The editor.
 * @returns The new state.
 */
export function selectAll(state: EditorState): EditorState {
  return selectRange(state, 0, state.text.length);
}

/**
 * Selects the word (or run of other characters) at a position, as a double-click does.
 *
 * @param state - The editor.
 * @param index - The position.
 * @returns The new state.
 */
export function selectWord(state: EditorState, index: number): EditorState {
  const [start, end] = wordRangeAt(state.text, index, languageAt(state, index));
  return selectRange(state, start, end);
}

/**
 * Left and right arrows (the prototype's `moveHorizontal`): a grapheme cluster or, with mod or Alt, a
 * word; Shift extends. Without Shift, a character move over a selection collapses it to its
 * side.
 *
 * @param state - The editor.
 * @param direction - −1 left, 1 right.
 * @param unit - A character or a word.
 * @param isExtending - Whether Shift is held.
 * @returns The new state.
 */
export function moveHorizontal(
  state: EditorState,
  direction: -1 | 1,
  unit: CaretUnit,
  isExtending: boolean,
): EditorState {
  if (!isExtending && hasSelection(state) && unit === 'character') {
    const [start, end] = selectionRange(state);
    return setCaret(state, direction < 0 ? start : end, false);
  }
  const { text, caret } = state;
  const index =
    unit === 'character'
      ? direction < 0
        ? previousGraphemeIndex(text, caret)
        : nextGraphemeIndex(text, caret)
      : direction < 0
        ? wordStartBefore(text, caret, languageAt(state, caret - 1))
        : wordEndAfter(text, caret, languageAt(state, caret));
  return setCaret(state, index, isExtending);
}

/**
 * Left and right arrows by a grapheme on screen: on a line with right-to-left text
 * the caret crosses the grapheme beside it on screen (`visualCaretStep`), and without Shift a
 * selection on one such line collapses to its end on that side; on a left-to-right line exactly
 * {@link moveHorizontal}.
 *
 * @param state - The editor.
 * @param direction - −1 left, 1 right.
 * @param isExtending - Whether Shift is held.
 * @param layout - The text's layout.
 * @returns The new state.
 */
export function moveOnScreen(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
  layout: TextLayout,
): EditorState {
  if (!isExtending && hasSelection(state)) {
    const [start, end] = selectionRange(state);
    const isOneMixedLine =
      lineOf(layout, start) === lineOf(layout, end) &&
      visualCaretStep(layout, start, direction) !== undefined;
    if (!isOneMixedLine) return moveHorizontal(state, direction, 'character', false);
    const isStartLeft =
      caretPlacement(layout, start).primary <= caretPlacement(layout, end).primary;
    const [left, right] = isStartLeft ? [start, end] : [end, start];
    return setCaret(state, direction < 0 ? left : right, false);
  }
  const step = visualCaretStep(layout, state.caret, direction);
  return step === undefined
    ? moveHorizontal(state, direction, 'character', isExtending)
    : setCaret(state, step, isExtending);
}

/**
 * Home and End: the start or visual end of the caret's line.
 *
 * @param state - The editor.
 * @param direction - −1 the start, 1 the end.
 * @param isExtending - Whether Shift is held.
 * @param layout - The text's layout.
 * @returns The new state.
 */
export function moveToLineEdge(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
  layout: TextLayout,
): EditorState {
  const line = lineOf(layout, state.caret);
  const index = direction < 0 ? (layout.lines[line]?.start ?? 0) : lineEndIndex(layout, line);
  return setCaret(state, index, isExtending);
}

/**
 * Up and down arrows: the nearest position on the line above or below at the caret's x; past
 * the first or last line, the text's start or end.
 *
 * @param state - The editor.
 * @param direction - −1 up, 1 down.
 * @param isExtending - Whether Shift is held.
 * @param layout - The text's layout.
 * @returns The new state.
 */
export function moveVertical(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
  layout: TextLayout,
): EditorState {
  const target = lineOf(layout, state.caret) + direction;
  if (target < 0) return setCaret(state, 0, isExtending);
  if (target >= layout.lines.length) return setCaret(state, state.text.length, isExtending);
  const { x } = caretRect(layout, state.caret);
  return setCaret(state, indexAtLine(layout, target, x), isExtending);
}

/**
 * The start or end of the whole text (mod with the up or down arrow).
 *
 * @param state - The editor.
 * @param direction - −1 the start, 1 the end.
 * @param isExtending - Whether Shift is held.
 * @returns The new state.
 */
export function moveToTextEdge(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
): EditorState {
  return setCaret(state, direction < 0 ? 0 : state.text.length, isExtending);
}

export { hardLineAt } from './hard-lines.js';

/**
 * Home and End while there is no layout (a face still loading): the start or end of
 * the caret's hard line.
 *
 * @param state - The editor.
 * @param direction - −1 start, 1 end.
 * @param isExtending - Whether Shift is held.
 * @returns The new state.
 */
export function moveToHardLineEdge(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
): EditorState {
  const [start, end] = hardLineAt(state.text, state.caret);
  return setCaret(state, direction < 0 ? start : end, isExtending);
}

/**
 * Up and Down while there is no layout: the same offset on the hard line above or
 * below, clamped to its end; the text's start or end from its first or last line.
 *
 * @param state - The editor.
 * @param direction - −1 up, 1 down.
 * @param isExtending - Whether Shift is held.
 * @returns The new state.
 */
export function moveHardLine(
  state: EditorState,
  direction: -1 | 1,
  isExtending: boolean,
): EditorState {
  return setCaret(state, hardLineStep(state.text, state.caret, direction), isExtending);
}
