import {
  findRunIssues,
  isSameTextStyle,
  MAX_LIST_LEVEL,
  type ParagraphStyle,
  type TextStyle,
} from '@canvas/schema';

import { hasSelection, insertStyleOf, selectionRange, type EditorState } from './editor-state.js';
import { nextGraphemeIndex, previousGraphemeIndex, snapToGrapheme } from './grapheme-steps.js';
import {
  paragraphAt,
  paragraphRange,
  PLAIN_PARAGRAPH,
  spliceParagraphs,
  touchedParagraphs,
} from './paragraph-edits.js';
import { applyStyle } from './runs/apply-style.js';
import { linkSpansOf, type LinkSpan } from './runs/link-spans.js';
import type { RunsPayload } from './runs/runs-payload.js';
import { insertRuns, spliceRuns } from './runs/splice-runs.js';
import type { TextStylePatch } from './runs/text-style-patch.js';

/**
 * Checks the run invariant after an edit: a broken one is a bug in the editor, which must never
 * reach the document.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @throws {Error} When the runs break the invariant.
 */
function assertRuns(text: string, runs: EditorState['runs']): void {
  const issues = findRunIssues(text, runs);
  if (issues.length > 0)
    throw new Error(`The editor broke the run invariant: ${issues.join('; ')}`);
}

/**
 * The single place text and runs change together (the prototype's `replaceRange`): replaces
 * `[from, to)` with characters in one style and puts the caret after them. The pending style
 * survives an insert and is cleared by a delete. Paragraph styles follow (`spliceParagraphs`).
 *
 * @param state - The editor.
 * @param from - The range's start, between code points.
 * @param to - Its end.
 * @param characters - What replaces it.
 * @param style - Their style; the insert style by default.
 * @returns The new state.
 * @throws {Error} When the result would break the run invariant (a bug).
 */
function replaceRange(
  state: EditorState,
  from: number,
  to: number,
  characters: string,
  style: TextStyle = insertStyleOf(state),
): EditorState {
  const text = state.text.slice(0, from) + characters + state.text.slice(to);
  const runs = spliceRuns(state.runs, from, to, characters.length, style);
  assertRuns(text, runs);
  const caret = snapToGrapheme(text, from + characters.length, 1);
  const paragraphs = spliceParagraphs(state.paragraphs, state.text, from, to, characters);
  const pending = characters ? state.pending : undefined;
  return { text, runs, caret, anchor: caret, pending, paragraphs };
}

/**
 * Types characters: replaces the selection, or inserts at the caret, in the insert style.
 *
 * @param state - The editor.
 * @param characters - What was typed (a newline for Enter).
 * @returns The new state.
 */
export function insertText(state: EditorState, characters: string): EditorState {
  const [start, end] = selectionRange(state);
  return replaceRange(state, start, end, characters);
}

/**
 * Backspace: deletes the selection, or the grapheme cluster before the caret (an emoji sequence,
 * a flag, a letter with its marks: whole, as the browser deletes it). At the start of a list
 * paragraph it ends the list there instead, the text left as it is.
 *
 * @param state - The editor.
 * @returns The new state; the same state at the text's start.
 */
export function deleteBackward(state: EditorState): EditorState {
  if (hasSelection(state)) return insertText(state, '');
  const paragraph = paragraphAt(state.text, state.caret);
  const isListStart =
    state.paragraphs[paragraph]?.list !== undefined &&
    paragraphRange(state.text, paragraph)[0] === state.caret;
  if (isListStart) return withParagraphs(state, [[paragraph, PLAIN_PARAGRAPH]]);
  if (state.caret === 0) return state;
  return replaceRange(state, previousGraphemeIndex(state.text, state.caret), state.caret, '');
}

/**
 * Delete: deletes the selection, or the grapheme cluster after the caret.
 *
 * @param state - The editor.
 * @returns The new state; the same state at the text's end.
 */
export function deleteForward(state: EditorState): EditorState {
  if (hasSelection(state)) return insertText(state, '');
  if (state.caret >= state.text.length) return state;
  return replaceRange(state, state.caret, nextGraphemeIndex(state.text, state.caret), '');
}

/**
 * Starts an input-method composition (the prototype's `beginComposition`). A collapsed caret is
 * left alone: the composition shows over the text without being part of it until it commits as
 * one `insertText`. A selection is deleted at once, but its insert style is pinned as the
 * pending style first, so the composed text commits in the selection's style rather than the
 * style of whatever now precedes the caret.
 *
 * @param state - The editor.
 * @returns The state to compose into.
 */
export function beginComposition(state: EditorState): EditorState {
  if (!hasSelection(state)) return state;
  const style = insertStyleOf(state);
  const [start, end] = selectionRange(state);
  return { ...replaceRange(state, start, end, ''), pending: style };
}

/**
 * The link a collapsed caret sits inside, when a patch changes only the link: editing
 * or removing a link from the caret's chip changes the whole link, as rich-text editors do. A
 * caret at a link's edge is outside it.
 *
 * @param state - The editor, its caret collapsed.
 * @param patch - The fields to set.
 * @returns The link's span, or undefined.
 */
function linkAround(state: EditorState, patch: TextStylePatch): LinkSpan | undefined {
  const keys = Object.keys(patch);
  if (keys.length !== 1 || keys[0] !== 'link') return undefined;
  return linkSpansOf(state.runs).find((at) => at.start < state.caret && state.caret < at.end);
}

/**
 * Changes style fields (the prototype's `setStyle`): over a selection, restyles it and keeps it
 * selected; at a collapsed caret, adds the fields to the pending style for the next insert, or
 * for a link alone with the caret inside a link, changes that whole link (`linkAround`).
 *
 * @param state - The editor.
 * @param patch - The fields to set.
 * @returns The new state.
 * @throws {Error} When the result would break the run invariant (a bug).
 */
export function setStyle(state: EditorState, patch: TextStylePatch): EditorState {
  const [start, end] = selectionRange(state);
  if (start === end) {
    const span = linkAround(state, patch);
    if (span === undefined) return { ...state, pending: { ...state.pending, ...patch } };
    const relinked = setStyle({ ...state, anchor: span.start, caret: span.end }, patch);
    return { ...relinked, anchor: state.anchor, caret: state.caret };
  }
  const runs = applyStyle(state.runs, start, end, patch);
  assertRuns(state.text, runs);
  // A field re-applies its choice when handing focus back. Preserve run identity for a no-op
  // so the session refreshes focus without writing a newly available font's size as a user edit.
  const isUnchanged =
    runs.length === state.runs.length &&
    runs.every((run, index) => {
      const previous = state.runs[index];
      return run.length === previous?.length && isSameTextStyle(run.style, previous.style);
    });
  return { ...state, runs: isUnchanged ? state.runs : runs, pending: undefined };
}

/**
 * Pastes text that carries its own runs over the selection (the prototype's `insertStyled`).
 *
 * @param state - The editor.
 * @param content - The pasted text and runs, already validated (`parseRunsPayload`).
 * @returns The new state, the caret after the paste.
 * @throws {Error} When the result would break the run invariant (a bug).
 */
export function insertStyled(state: EditorState, content: RunsPayload): EditorState {
  const [start, end] = selectionRange(state);
  const cleared = spliceRuns(state.runs, start, end, 0, insertStyleOf(state));
  const text = state.text.slice(0, start) + content.text + state.text.slice(end);
  const runs = insertRuns(cleared, start, content.runs);
  assertRuns(text, runs);
  const caret = snapToGrapheme(text, start + content.text.length, 1);
  const spliced = spliceParagraphs(state.paragraphs, state.text, start, end, content.text);
  const paragraphs = withPastedParagraphs(spliced, state, start, content);
  return { text, runs, caret, anchor: caret, pending: undefined, paragraphs };
}

/**
 * The paragraph styles after a paste that carries its own: each paragraph the paste
 * starts takes the pasted style; the paragraph it starts in keeps its own, unless that is plain
 * and the paste starts at its start, when it takes the first pasted style.
 *
 * @param spliced - The styles after the splice, new paragraphs in the target's style.
 * @param state - The editor before the paste.
 * @param start - Where the paste starts.
 * @param content - The pasted content.
 * @returns The styles.
 */
function withPastedParagraphs(
  spliced: readonly ParagraphStyle[],
  state: EditorState,
  start: number,
  content: RunsPayload,
): readonly ParagraphStyle[] {
  const pasted = content.paragraphs;
  if (pasted === undefined) return spliced;
  const first = paragraphAt(state.text, start);
  const paragraphs = [...spliced];
  const isPlainStart =
    state.paragraphs[first]?.list === undefined && paragraphRange(state.text, first)[0] === start;
  pasted.forEach((style, index) => {
    if (index === 0 && !isPlainStart) return;
    paragraphs[first + index] = style;
  });
  return paragraphs;
}

/**
 * The state with some paragraphs restyled; the same state when none changes.
 *
 * @param state - The editor.
 * @param changes - Paragraph indices and their new styles.
 * @returns The new state.
 */
function withParagraphs(
  state: EditorState,
  changes: readonly (readonly [paragraph: number, style: ParagraphStyle])[],
): EditorState {
  const paragraphs = [...state.paragraphs];
  let isChanged = false;
  for (const [paragraph, style] of changes) {
    const current = paragraphs[paragraph];
    if (current?.list === style.list && current?.level === style.level) continue;
    paragraphs[paragraph] = style;
    isChanged = true;
  }
  return isChanged ? { ...state, paragraphs } : state;
}

/**
 * A list style at a level, a level of 0 written with no key.
 *
 * @param list - The kind of list.
 * @param level - Its level, 0 to `MAX_LIST_LEVEL`.
 * @returns The paragraph style.
 */
function listStyle(list: 'bullet' | 'numbered', level: number): ParagraphStyle {
  return level === 0 ? { list } : { list, level };
}

/**
 * The indices of the paragraphs the selection touches: the caret's alone when collapsed.
 *
 * @param state - The editor.
 * @returns The indices, in order.
 */
function touchedOf(state: EditorState): number[] {
  const [start, end] = selectionRange(state);
  const [first, last] = touchedParagraphs(state.text, start, end);
  const touched: number[] = [];
  for (let paragraph = first; paragraph <= last; paragraph += 1) touched.push(paragraph);
  return touched;
}

/**
 * Turns a list on or off over the paragraphs the selection touches (the popover's list
 * menu): off when every one of them is already that kind of list, else on, each keeping its
 * level if it was a list. Text, runs and selection stay.
 *
 * @param state - The editor.
 * @param kind - The kind of list.
 * @returns The new state.
 */
export function toggleList(state: EditorState, kind: 'bullet' | 'numbered'): EditorState {
  const touched = touchedOf(state);
  const isOn = touched.every((paragraph) => state.paragraphs[paragraph]?.list === kind);
  return withParagraphs(
    state,
    touched.map((paragraph) => {
      const level = state.paragraphs[paragraph]?.level ?? 0;
      return [paragraph, isOn ? PLAIN_PARAGRAPH : listStyle(kind, level)] as const;
    }),
  );
}

/**
 * Sets the list of the paragraphs the selection touches (the list menu): each becomes
 * that kind of list, keeping its level if it was one, or plain for `null`.
 *
 * @param state - The editor.
 * @param kind - The kind of list, or `null` for none.
 * @returns The new state; the same state when nothing changes.
 */
export function setList(state: EditorState, kind: 'bullet' | 'numbered' | null): EditorState {
  return withParagraphs(
    state,
    touchedOf(state).map((paragraph) => {
      const level = state.paragraphs[paragraph]?.level ?? 0;
      return [paragraph, kind === null ? PLAIN_PARAGRAPH : listStyle(kind, level)] as const;
    }),
  );
}

/**
 * The list the paragraphs the selection touches share: the list menu's check mark.
 *
 * @param state - The editor.
 * @returns Their kind of list, `none` when all are plain, `mixed` when they differ.
 */
export function selectionListOf(state: EditorState): 'bullet' | 'numbered' | 'none' | 'mixed' {
  const kinds = new Set(touchedOf(state).map((paragraph) => state.paragraphs[paragraph]?.list));
  if (kinds.size !== 1) return 'mixed';
  const [kind] = kinds;
  return kind ?? 'none';
}

/**
 * Indents or outdents the list paragraphs the selection touches by one level (Tab and
 * Shift+Tab), between 0 and `MAX_LIST_LEVEL`; plain paragraphs stay.
 *
 * @param state - The editor.
 * @param delta - +1 to indent, -1 to outdent.
 * @returns The new state, or `undefined` when no touched paragraph is a list (so Tab can do
 *   what it does elsewhere).
 */
export function changeListLevel(state: EditorState, delta: 1 | -1): EditorState | undefined {
  const lists = touchedOf(state).flatMap((paragraph) => {
    const { list, level = 0 } = state.paragraphs[paragraph] ?? PLAIN_PARAGRAPH;
    if (list === undefined) return [];
    const next = Math.min(MAX_LIST_LEVEL, Math.max(0, level + delta));
    return [[paragraph, listStyle(list, next)] as const];
  });
  return lists.length === 0 ? undefined : withParagraphs(state, lists);
}

/** What typed at a plain paragraph's start, then a space, starts a list. */
const LIST_TRIGGERS: readonly (readonly [prefix: string, list: 'bullet' | 'numbered'])[] = [
  ['- ', 'bullet'],
  ['* ', 'bullet'],
  ['1. ', 'numbered'],
];

/**
 * The markdown list shortcut, after a typed space: `- `, `* ` or `1. ` alone at the
 * start of a plain paragraph is removed and the paragraph becomes that list.
 *
 * @param state - The editor, after the space was typed.
 * @returns The new state, the caret at the paragraph's start; `undefined` when no trigger
 *   applies.
 */
export function applyListTrigger(state: EditorState): EditorState | undefined {
  if (hasSelection(state)) return undefined;
  const paragraph = paragraphAt(state.text, state.caret);
  if (state.paragraphs[paragraph]?.list !== undefined) return undefined;
  const [start] = paragraphRange(state.text, paragraph);
  const typed = state.text.slice(start, state.caret);
  const trigger = LIST_TRIGGERS.find(([prefix]) => prefix === typed);
  if (trigger === undefined) return undefined;
  const removed = replaceRange(state, start, state.caret, '', insertStyleOf(state));
  return withParagraphs(removed, [[paragraph, { list: trigger[1] }]]);
}

/**
 * Enter: in an empty list paragraph it steps out of the list, one level at a time and
 * then out of it, typing nothing; anywhere else it starts a new paragraph, which keeps the list.
 *
 * @param state - The editor.
 * @returns The new state.
 */
export function insertParagraphBreak(state: EditorState): EditorState {
  if (!hasSelection(state)) {
    const paragraph = paragraphAt(state.text, state.caret);
    const style = state.paragraphs[paragraph] ?? PLAIN_PARAGRAPH;
    const [start, end] = paragraphRange(state.text, paragraph);
    if (style.list !== undefined && start === end) {
      const level = style.level ?? 0;
      const next = level > 0 ? listStyle(style.list, level - 1) : PLAIN_PARAGRAPH;
      return withParagraphs(state, [[paragraph, next]]);
    }
  }
  return insertText(state, '\n');
}
