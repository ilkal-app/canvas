import { normalizeLink } from '@canvas/schema';

import { selectionRange, type EditorState } from './editor-state.js';
import { insertText, setStyle } from './editor.js';
import { styleOfCharacter } from './runs/style-at.js';
import { isWordEnd } from './text-session-permission.js';
import type { TextEditingSession } from './text-session.js';

/** Characters that open a URL's surroundings, not the URL: `(see https://…`. */
const OPENERS = new Set(['(', '[', '{', '<', '"', "'", '“', '‘', '«']);

/** Characters that close a sentence or a bracket after a URL, not the URL: `…/guide).`. */
const CLOSERS = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '”',
  '’',
  '»',
]);

/** What starts a URL that becomes a link as it is typed or pasted: a scheme, or `www.`. */
const URL_START = /^(?:https?:\/\/|mailto:|www\.)/iu;

/** A range of the text that reads as a link, and the link it takes. */
export interface AutoLink {
  /** Where the URL starts, UTF-16 code units. */
  readonly start: number;
  /** Where it ends (exclusive). */
  readonly end: number;
  /** The link, in `normalizeLink`'s normal form. */
  readonly link: string;
}

/**
 * How many brackets of one kind a URL holds unbalanced: `(` counted up, `)` down.
 *
 * @param url - The URL.
 * @returns Opened minus closed.
 */
function openParentheses(url: string): number {
  let open = 0;
  for (const character of url) {
    if (character === '(') open += 1;
    else if (character === ')') open -= 1;
  }
  return open;
}

/**
 * The URL a word holds, without the punctuation around it: the word less any opening
 * quote or bracket before it and any sentence punctuation or closing bracket after it (a closing
 * parenthesis stays when the URL opened one, as in `…/Foo_(bar)`), when it starts with
 * `http://`, `https://`, `mailto:` or `www.` (`www.` read as `https://www.`) and `normalizeLink`
 * accepts it: so `javascript:`, `data:` and every other scheme never become links. Pure.
 *
 * @param text - The text.
 * @param start - Where the word starts.
 * @param end - Where it ends (exclusive).
 * @returns The URL's range and link, or undefined.
 */
export function urlInWord(text: string, start: number, end: number): AutoLink | undefined {
  let from = start;
  let to = end;
  while (from < to && OPENERS.has(text.charAt(from))) from += 1;
  while (from < to && CLOSERS.has(text.charAt(to - 1))) {
    if (text.charAt(to - 1) === ')' && openParentheses(text.slice(from, to)) >= 0) break;
    to -= 1;
  }
  const url = text.slice(from, to);
  if (!URL_START.test(url)) return undefined;
  const link = normalizeLink(/^www\./iu.test(url) ? `https://${url}` : url);
  return link === undefined ? undefined : { start: from, end: to, link };
}

/**
 * The URL that ends where a space or a line break was typed: the word before `end`
 * (back to the previous whitespace), read by {@link urlInWord}. Pure.
 *
 * @param text - The text.
 * @param end - Where the word ends: the typed space's index.
 * @returns The URL's range and link, or undefined.
 */
export function urlBefore(text: string, end: number): AutoLink | undefined {
  let start = end;
  while (start > 0 && !/\s/u.test(text.charAt(start - 1))) start -= 1;
  return start === end ? undefined : urlInWord(text, start, end);
}

/**
 * Whether any character of a range carries a link already: a URL typed inside a link, or one
 * given a link by hand, is left as it is.
 *
 * @param state - The editor.
 * @param found - The range.
 * @returns True when one does.
 */
function isLinked(state: EditorState, found: AutoLink): boolean {
  for (let index = found.start; index < found.end; index += 1) {
    if (styleOfCharacter(state.runs, index).link !== undefined) return true;
  }
  return false;
}

/**
 * The editor with a found URL linked, the caret, selection and pending style as they were.
 *
 * @param state - The editor.
 * @param found - The URL.
 * @returns The new state.
 */
function linked(state: EditorState, found: AutoLink): EditorState {
  const selected = { ...state, anchor: found.start, caret: found.end };
  const restyled = setStyle(selected, { link: found.link });
  return { ...restyled, caret: state.caret, anchor: state.anchor, pending: state.pending };
}

/**
 * Links the URL typed before a space or line break (as rich-text editors do): when the
 * characters before `end` are a URL ({@link urlBefore}) with no link yet, they take its link.
 * Undefined when there is nothing to link. Pure.
 *
 * @param state - The editor after the space was typed.
 * @param end - The typed space's index: where the URL ends.
 * @returns The editor with the URL linked, or undefined.
 */
export function autoLinkBefore(state: EditorState, end: number): EditorState | undefined {
  const found = urlBefore(state.text, end);
  return found === undefined || isLinked(state, found) ? undefined : linked(state, found);
}

/**
 * Links pasted text that is one URL: the range, less surrounding whitespace, when it
 * is a single word that {@link urlInWord} reads as a URL whole, with no link yet. Undefined when
 * there is nothing to link. Pure.
 *
 * @param state - The editor after the paste.
 * @param start - Where the pasted text starts.
 * @param end - Where it ends (exclusive).
 * @returns The editor with the URL linked, or undefined.
 */
export function autoLinkPasted(
  state: EditorState,
  start: number,
  end: number,
): EditorState | undefined {
  let from = start;
  let to = end;
  while (from < to && /\s/u.test(state.text.charAt(from))) from += 1;
  while (from < to && /\s/u.test(state.text.charAt(to - 1))) to -= 1;
  if (from === to || /\s/u.test(state.text.slice(from, to))) return undefined;
  const found = urlInWord(state.text, from, to);
  if (found?.start !== from || found.end !== to || isLinked(state, found)) return undefined;
  return linked(state, found);
}

/**
 * Where typing over the selection or at the caret inserts: the selection's start.
 *
 * @param state - The editor before the edit.
 * @returns The index.
 */
export function insertionStart(state: EditorState): number {
  return selectionRange(state)[0];
}

/**
 * Links the URL that ends where a space or line break was just typed in a session (as
 * rich-text editors do): its own undo step after the typing step, so one undo takes the link
 * off and leaves the text. While a stepped run holds the store, the held edits are written as
 * one step (`TextEdits`), the link with them. Nothing when no URL ends there, or it has a link.
 *
 * @param session - The session, the space typed.
 * @param end - Where the space was typed: where the URL ends.
 */
export function linkTypedUrl(session: TextEditingSession, end: number): void {
  const next = autoLinkBefore(session.editor, end);
  if (next !== undefined) session.apply(next, 'command');
}

/**
 * Types characters over a session's selection, or at its caret, as a typing edit (a space or
 * line break ends the word's undo step), then links a URL the space or line break ends
 * (`linkTypedUrl`).
 *
 * @param session - The session.
 * @param characters - The characters, not empty; a newline for Enter.
 */
export function typeLinkingUrls(session: TextEditingSession, characters: string): void {
  const start = insertionStart(session.editor);
  session.apply(insertText(session.editor, characters), 'typing', isWordEnd(characters));
  if (/^\s/u.test(characters)) linkTypedUrl(session, start);
}
