import type { ParagraphStyle, StyleRun } from '@canvas/schema';

import type { EditorState } from './editor-state.js';
import { snapToGrapheme } from './grapheme-steps.js';
import { plainParagraphsOf } from './paragraph-edits.js';

/**
 * Maps a position through a change from `before` to `after` found by common prefix and suffix:
 * positions in the prefix stay, positions in the suffix move with it, positions in the changed
 * middle go to the end of what replaced it.
 *
 * @param before - The old text.
 * @param after - The new text.
 * @param index - A position in the old text.
 * @returns The position in the new text.
 */
function mapPosition(before: string, after: string, index: number): number {
  const { prefix, suffix } = changedSpan(before, after);
  if (index <= prefix) return index;
  if (index >= before.length - suffix) return index + after.length - before.length;
  return after.length - suffix;
}

/**
 * The common prefix and suffix of two texts: what a change left alone at each end.
 *
 * @param before - The old text.
 * @param after - The new text.
 * @returns Their lengths, not overlapping in either text.
 */
function changedSpan(before: string, after: string): { prefix: number; suffix: number } {
  let prefix = 0;
  const shorter = Math.min(before.length, after.length);
  while (prefix < shorter && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

/**
 * Brings an editing session up to date with the document when its text changed under the
 * editor: a collaborator typed in the same text, or an undo reverted a step. The caret and the
 * selection move with the text around them (a common-prefix and suffix diff, as the store writes
 * edits), so typing continues where it was; after the user's own undo or redo the caret goes to
 * the end of what changed. The pending style is kept when the text is unchanged (a restyle
 * elsewhere). Pure.
 *
 * @param state - The editor.
 * @param text - The document's text now.
 * @param runs - Its runs now.
 * @param isOwnUndo - Whether the change is the user's own undo or redo.
 * @param paragraphs - Its paragraph styles now; all plain when absent.
 * @returns The state over the document's content; the same state when nothing changed.
 */
export function followDocument(
  state: EditorState,
  text: string,
  runs: readonly StyleRun[],
  isOwnUndo = false,
  paragraphs: readonly ParagraphStyle[] = plainParagraphsOf(text),
): EditorState {
  const isSameParagraphs =
    paragraphs.length === state.paragraphs.length &&
    paragraphs.every(
      (style, index) =>
        style.list === state.paragraphs[index]?.list &&
        style.level === state.paragraphs[index]?.level,
    );
  if (text === state.text && runs === state.runs && isSameParagraphs) return state;
  if (isOwnUndo && text !== state.text) {
    // The user's own undo or redo: the caret goes to the end of what it changed, as in any editor.
    const { suffix } = changedSpan(state.text, text);
    const caret = snapToGrapheme(text, text.length - suffix, 1);
    return { text, runs, caret, anchor: caret, pending: undefined, paragraphs };
  }
  const caret = snapToGrapheme(text, mapPosition(state.text, text, state.caret));
  const anchor = snapToGrapheme(text, mapPosition(state.text, text, state.anchor));
  const pending = text === state.text ? state.pending : undefined;
  return { text, runs, caret, anchor, pending, paragraphs };
}
