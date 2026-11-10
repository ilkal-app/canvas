import { linkTypedUrl, typeLinkingUrls } from './auto-link.js';
import { moveCaret } from './caret-motion.js';
import { selectRange } from './editor-navigation.js';
import { hasSelection, selectionRange } from './editor-state.js';
import {
  applyListTrigger,
  deleteBackward,
  deleteForward,
  insertParagraphBreak,
  insertText,
} from './editor.js';
import type { TextEditingSession } from './text-session.js';

/** How far a delete reaches: a character, a word, or to the line's edge. */
export type DeletionUnit = 'character' | 'word' | 'lineEdge';

/**
 * Deletes backward or forward (the input events' `deleteContent*`, `deleteWord*` and
 * `deleteSoftLine*`/`deleteHardLine*`): a selection whatever the unit, else a code point, a word
 * (as mod or Alt with an arrow moves), or to the edge of the caret's line as laid out (as Home and
 * End move; the text's edge while no font is loaded). At a line's edge a line delete takes the
 * line break, as a character delete would. A typing edit, in the word's undo step.
 *
 * @param session - The session.
 * @param unit - How far.
 * @param direction - −1 backward (Backspace), 1 forward (Delete).
 */
export function deleteBy(session: TextEditingSession, unit: DeletionUnit, direction: -1 | 1): void {
  const state = session.editor;
  const extended =
    unit === 'character' || hasSelection(state)
      ? state
      : moveCaret(state, { unit, direction, isExtending: true }, session.layout());
  // At the edge of a line or word already, the character (the line break) goes instead.
  const reach = hasSelection(extended) ? extended : state;
  session.apply(direction < 0 ? deleteBackward(reach) : deleteForward(reach), 'typing');
}

/**
 * Types characters at the caret or over the selection (the session's `type`), with the list
 * behaviours: Enter in an empty list item steps out of the list instead of starting a
 * new item, and a space after `- `, `* ` or `1. ` at a plain paragraph's start makes it a list.
 * Each list change is a command, its own undo step, so undo takes back the list and leaves the
 * typing; the rest is typing that links URLs (`typeLinkingUrls`).
 *
 * @param session - The session.
 * @param characters - The characters, not empty; a newline for Enter.
 */
export function typeText(session: TextEditingSession, characters: string): void {
  if (characters === '\n') {
    const stepped = insertParagraphBreak(session.editor);
    if (stepped.text === session.editor.text) {
      session.apply(stepped, 'command');
      return;
    }
  }
  typeLinkingUrls(session, characters);
  applyTrigger(session, characters);
}

/**
 * Applies the markdown list shortcut after a typed space (`applyListTrigger`), as its own step.
 *
 * @param session - The session.
 * @param characters - What was just typed.
 */
function applyTrigger(session: TextEditingSession, characters: string): void {
  if (characters !== ' ') return;
  const listed = applyListTrigger(session.editor);
  if (listed !== undefined) session.apply(listed, 'command');
}

/**
 * Replaces a range of the text with typed characters (the hidden input's own edit, found by
 * comparing its value with what it mirrored, where the browser gave no usable `beforeinput`):
 * the characters take the range's insert style, as typing over a selection does (at the caret or
 * over the selection, the pending style too). A typing edit;
 * a space or line break typed ends the word's undo step, and links a URL before it
 * (`linkTypedUrl`).
 *
 * @param session - The session.
 * @param start - The range's start, UTF-16 code units.
 * @param end - Its end.
 * @param characters - What replaces it; empty to delete.
 */
export function replaceText(
  session: TextEditingSession,
  start: number,
  end: number,
  characters: string,
): void {
  if (start === end && characters === '') return;
  const state = session.editor;
  const [selectedStart, selectedEnd] = selectionRange(state);
  // The selection itself is replaced as typing replaces it, the pending style kept.
  const isSelection = start === selectedStart && end === selectedEnd;
  const selected = isSelection ? state : selectRange(state, start, end);
  if (characters === '\n' && start === end) {
    // Enter in an empty list item steps out of the list, as typed Enter does.
    const stepped = insertParagraphBreak(selected);
    if (stepped.text === selected.text) {
      session.apply(stepped, 'command');
      return;
    }
  }
  session.apply(insertText(selected, characters), 'typing', /\s/u.test(characters));
  if (/^\s/u.test(characters)) linkTypedUrl(session, start);
  applyTrigger(session, characters);
}
