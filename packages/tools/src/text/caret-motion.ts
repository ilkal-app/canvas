import type { TextLayout } from '@canvas/engine';

import {
  moveHardLine,
  moveHorizontal,
  moveOnScreen,
  moveToHardLineEdge,
  moveToLineEdge,
  moveToTextEdge,
  moveVertical,
} from './editor-navigation.js';
import type { EditorState } from './editor-state.js';

/** A caret move from the keyboard. */
export interface CaretMotion {
  /** By a character or word (left, right), a line (up, down), to a line's edge, to the text's edge. */
  readonly unit: 'character' | 'word' | 'line' | 'lineEdge' | 'textEdge';
  /** −1 left, up or towards the start; 1 right, down or towards the end. */
  readonly direction: -1 | 1;
  /** Whether Shift is held: the selection extends. */
  readonly isExtending: boolean;
}

/**
 * Applies a keyboard caret move: arrows by character (by what is on
 * screen in right-to-left text), mod or Alt arrows by word, up and down by line through
 * the layout, Home and End to the line's edges, mod with up or down to the text's edges. Without
 * a layout (a face still loading) line moves follow the text's hard lines. Pure.
 *
 * @param state - The editor.
 * @param motion - The move.
 * @param layout - The text's layout, for line moves.
 * @returns The new state.
 */
export function moveCaret(
  state: EditorState,
  motion: CaretMotion,
  layout: TextLayout | undefined,
): EditorState {
  const { unit, direction, isExtending } = motion;
  switch (unit) {
    case 'character':
      // By what is on screen where the line holds right-to-left text.
      return layout === undefined
        ? moveHorizontal(state, direction, unit, isExtending)
        : moveOnScreen(state, direction, isExtending, layout);
    case 'word':
      return moveHorizontal(state, direction, unit, isExtending);
    // Without a layout (a face still loading) by the text's hard lines.
    case 'line':
      return layout === undefined
        ? moveHardLine(state, direction, isExtending)
        : moveVertical(state, direction, isExtending, layout);
    case 'lineEdge':
      return layout === undefined
        ? moveToHardLineEdge(state, direction, isExtending)
        : moveToLineEdge(state, direction, isExtending, layout);
    case 'textEdge':
      return moveToTextEdge(state, direction, isExtending);
  }
}
