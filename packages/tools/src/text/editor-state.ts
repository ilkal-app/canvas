import type { ParagraphStyle, StyleRun, TextStyle } from '@canvas/schema';

import { snapToGrapheme } from './grapheme-steps.js';
import { paragraphAt, plainParagraphsOf } from './paragraph-edits.js';
import { mergeStyle } from './runs/apply-style.js';
import type { RunsPayload } from './runs/runs-payload.js';
import { sliceRuns } from './runs/splice-runs.js';
import { styleAt, styleOfCharacter } from './runs/style-at.js';
import type { TextStylePatch } from './runs/text-style-patch.js';

/**
 * A text editing session's state (the prototype's `EditorState`, webgl-whiteboard
 * `src/text/editor.ts`, over the schema's types): the text and its runs as the editor last
 * wrote or read them, the caret and the selection's other end, and the pending style a style
 * change at a collapsed caret leaves for the next insert. Positions are UTF-16 code units, always
 * between grapheme clusters (code points without Intl.Segmenter). A plain value; the editor's functions return new states.
 */
export interface EditorState {
  /** The characters. */
  readonly text: string;
  /** Their runs, under the schema's run invariant. */
  readonly runs: readonly StyleRun[];
  /** Where the caret is: the selection's moving end. */
  readonly caret: number;
  /** The selection's fixed end; equal to `caret` when nothing is selected. */
  readonly anchor: number;
  /**
   * Style fields chosen at a collapsed caret, applied to the next typed text: set by a style
   * change, kept through typing, cleared by any caret move or delete.
   */
  readonly pending: TextStylePatch | undefined;
  /** One style per paragraph: its list, if any. Always `paragraphCount(text)` long. */
  readonly paragraphs: readonly ParagraphStyle[];
}

/**
 * Starts editing text with the caret at a position.
 *
 * @param text - The characters.
 * @param runs - Their runs.
 * @param caret - Where the caret goes; the end by default.
 * @param paragraphs - One style per paragraph; all plain when absent.
 * @returns The state, nothing selected and no pending style.
 */
export function createEditorState(
  text: string,
  runs: readonly StyleRun[],
  caret = text.length,
  paragraphs: readonly ParagraphStyle[] = plainParagraphsOf(text),
): EditorState {
  const position = snapToGrapheme(text, caret);
  return { text, runs, caret: position, anchor: position, pending: undefined, paragraphs };
}

/**
 * The selection as a range.
 *
 * @param state - The editor.
 * @returns `[start, end]`, start first.
 */
export function selectionRange(state: EditorState): readonly [start: number, end: number] {
  return [Math.min(state.caret, state.anchor), Math.max(state.caret, state.anchor)];
}

/**
 * Whether anything is selected.
 *
 * @param state - The editor.
 * @returns Whether the caret and anchor differ.
 */
export function hasSelection(state: EditorState): boolean {
  return state.caret !== state.anchor;
}

/**
 * The selected text with its runs, for copy and cut.
 *
 * @param state - The editor.
 * @returns The content, or undefined when nothing is selected.
 */
export function selectedContent(state: EditorState): RunsPayload | undefined {
  const [start, end] = selectionRange(state);
  if (start === end) return undefined;
  const text = state.text.slice(start, end);
  const runs = sliceRuns(state.runs, start, end);
  // The paragraphs the selection reaches into, when one is a list.
  const paragraphs = state.paragraphs.slice(
    paragraphAt(state.text, start),
    paragraphAt(state.text, end) + 1,
  );
  const hasLists = paragraphs.some((style) => style.list !== undefined);
  return hasLists ? { text, runs, paragraphs } : { text, runs };
}

/**
 * The style newly typed text gets (the prototype's `insertStyleOf`): the first selected
 * character's over a selection; otherwise the character before the caret's, except at the start
 * of a line (the text's start or just after a newline) with a character after it on the same
 * line, which gives its style instead; a caret at a link's edge drops the link; then
 * the pending style laid over it.
 *
 * @param state - The editor.
 * @returns The style.
 */
export function insertStyleOf(state: EditorState): TextStyle {
  const [start, end] = selectionRange(state);
  const { text, runs } = state;
  let base: TextStyle;
  if (start !== end) {
    base = styleOfCharacter(runs, start);
  } else {
    const isAtLineStart = start === 0 || text[start - 1] === '\n';
    const hasFollowing = start < text.length && text[start] !== '\n';
    base = isAtLineStart && hasFollowing ? styleOfCharacter(runs, start) : styleAt(runs, start);
    base = withoutEdgeLink(state, start, base);
  }
  return state.pending === undefined ? base : mergeStyle(base, state.pending);
}

/**
 * A caret's style without a link it sits at the edge of: typing at a link's end or
 * start is plain, as in rich-text editors; only text typed between two characters of the same
 * link joins it.
 *
 * @param state - The editor.
 * @param caret - The collapsed caret.
 * @param style - The style typing would take.
 * @returns The style, its link kept only inside the link.
 */
function withoutEdgeLink(state: EditorState, caret: number, style: TextStyle): TextStyle {
  if (style.link === undefined) return style;
  const { text, runs } = state;
  const isInside =
    caret > 0 &&
    caret < text.length &&
    styleOfCharacter(runs, caret - 1).link === style.link &&
    styleOfCharacter(runs, caret).link === style.link;
  if (isInside) return style;
  return Object.fromEntries(
    Object.entries(style).filter(([field]) => field !== 'link'),
  ) as TextStyle;
}
