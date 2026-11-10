import type { EditorState } from './editor-state.js';
import type { EditableTextObject } from './text-box-object.js';
import type { TextModeContext } from './text-mode-context.js';

/** What the person is told when a collaborator locks the text they are editing. */
export const LOCKED_WHILE_EDITING_NOTICE = 'This text was locked, so editing it ended.';

/**
 * Whether typing these characters ends a word, and with it an undo step.
 *
 * @param characters - What was typed.
 * @returns Whether it holds a space or a line break.
 */
export function isWordEnd(characters: string): boolean {
  return /[\s]/u.test(characters);
}

/**
 * Rechecks word edits against fonts after remote restyles; style-only changes remain allowed.
 *
 * @param context - The host permission callback.
 * @param object - Current text object.
 * @param before - Current words.
 * @param after - Requested edit.
 * @returns Whether this edit may be written.
 */
export function canWriteText(
  context: TextModeContext,
  object: EditableTextObject | undefined,
  before: EditorState,
  after: EditorState,
): boolean {
  return (
    after.text === before.text || object === undefined || context.canEditText?.(object) !== false
  );
}
