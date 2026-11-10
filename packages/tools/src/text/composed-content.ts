import { insertStyleOf, type EditorState } from './editor-state.js';
import { spliceParagraphs } from './paragraph-edits.js';
import { spliceRuns } from './runs/splice-runs.js';
import type { TextContent } from './text-content-writer.js';

/** Text as an editing session shows it: its content and the composition's range in it. */
export interface ComposedContent extends TextContent {
  /** Where the input method's composition sits, or `undefined` when nothing is composed. */
  readonly composition: readonly [start: number, end: number] | undefined;
  /**
   * The input method's selection in the composition, in the shown text: its caret
   * when collapsed, else the target segment (the clause being converted); `undefined` when
   * nothing is composed.
   */
  readonly compositionSelection: readonly [start: number, end: number] | undefined;
}

/** An input method's composition: its text so far, and its selection in it. */
export interface Composition {
  /** The composed text; empty while nothing is composed yet. */
  readonly text: string;
  /**
   * Its caret when collapsed, else the target segment (the clause being converted), in UTF-16
   * units of the text; the text's end when absent.
   */
  readonly selection?: readonly [start: number, end: number] | undefined;
}

/**
 * The text an editing session shows while an input method composes (the prototype's
 * `displayContent`): the editor's text with the composition spliced in at the caret, in the insert
 * style, so the preview renders styled and positions after it stay valid; with the paragraph
 * styles, so the session lays lists out as the engine does. The composition is never
 * written until it commits. Pure.
 *
 * @param state - The editor.
 * @param composition - The composition; `undefined`, or empty text, when not composing.
 * @returns The content to show, the composition's range and its selection, clamped to it.
 */
export function composedContent(
  state: EditorState,
  composition: Composition | undefined,
): ComposedContent {
  const { text, runs, caret, paragraphs } = state;
  if (composition === undefined || composition.text === '') {
    return { text, runs, paragraphs, composition: undefined, compositionSelection: undefined };
  }
  const { length } = composition.text;
  const clamp = (offset: number): number => caret + Math.max(0, Math.min(length, offset));
  const [from, to] = composition.selection ?? [length, length];
  return {
    text: text.slice(0, caret) + composition.text + text.slice(caret),
    runs: spliceRuns(runs, caret, caret, length, insertStyleOf(state)),
    paragraphs: spliceParagraphs(paragraphs, text, caret, caret, composition.text),
    composition: [caret, caret + length],
    compositionSelection: [clamp(Math.min(from, to)), clamp(Math.max(from, to))],
  };
}
