import { normalizeLink } from '@canvas/schema';

import { autoLinkPasted, insertionStart } from './auto-link.js';
import { hasSelection, selectedContent } from './editor-state.js';
import { insertStyled, insertText, setStyle } from './editor.js';
import type { RunsPayload } from './runs/runs-payload.js';
import type { TextEditingSession } from './text-session.js';

/**
 * The styled content of an editing session's selection, for copy: the
 * clipboard gets it as `text/plain` and as the runs flavour.
 *
 * @param session - The session.
 * @returns The content, or `undefined` when nothing is selected.
 */
export function copySelection(session: TextEditingSession): RunsPayload | undefined {
  return selectedContent(session.editor);
}

/**
 * Copies the selection and deletes it, one undo step.
 *
 * @param session - The session.
 * @returns The content, or `undefined` when nothing is selected.
 */
export function cutSelection(session: TextEditingSession): RunsPayload | undefined {
  const content = selectedContent(session.editor);
  if (content !== undefined) session.apply(insertText(session.editor, ''), 'command');
  return content;
}

/**
 * Pastes over the selection, one undo step: content with its own runs (the runs flavour, already
 * validated by `parseRunsPayload`), or plain text in the insert style, line ends normalised.
 * Plain text that is a link (`normalizeLink`, trimmed) pasted onto a selection links the
 * selection instead, its text unchanged, as rich-text editors do. Plain text that is
 * one URL pasted with nothing selected is inserted, then linked as its own undo step
 * (`autoLinkPasted`), so one undo takes the link off and leaves the text.
 *
 * @param session - The session.
 * @param content - The runs payload, or plain text.
 */
export function pasteInto(session: TextEditingSession, content: RunsPayload | string): void {
  if (typeof content !== 'string') {
    session.apply(insertStyled(session.editor, content), 'command');
    return;
  }
  const link = hasSelection(session.editor) ? normalizeLink(content) : undefined;
  if (link !== undefined) {
    session.apply(setStyle(session.editor, { link }), 'command');
    return;
  }
  const text = content.replace(/\r\n?/gu, '\n');
  if (text === '') return;
  const start = insertionStart(session.editor);
  session.apply(insertText(session.editor, text), 'command');
  const pasted = autoLinkPasted(session.editor, start, start + text.length);
  if (pasted !== undefined) session.apply(pasted, 'command');
}
