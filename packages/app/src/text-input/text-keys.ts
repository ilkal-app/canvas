import { selectionListOf, type CaretMotion, type EditorState } from '@canvas/tools';

import { isImeKey } from '../shortcuts/ime-key.js';
import type { KeyEventLike } from '../shortcuts/key-event-match.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';

/**
 * A key the text editor hands to its owner: undo, redo, Escape, bold, italic, underline and
 * strikethrough.
 */
export interface TextCommandAction {
  /** Which. */
  readonly kind:
    | 'undo'
    | 'redo'
    | 'escape'
    | 'toggleBold'
    | 'toggleItalic'
    | 'toggleUnderline'
    | 'toggleStrikethrough'
    | 'indentList'
    | 'outdentList';
}

/** What a key pressed in the text editor does, beyond the characters it types. */
export type TextKeyAction =
  | { readonly kind: 'move'; readonly motion: CaretMotion }
  | { readonly kind: 'selectAll' }
  | TextCommandAction;

const ARROWS: Readonly<Record<string, readonly ['horizontal' | 'vertical', -1 | 1]>> = {
  ArrowLeft: ['horizontal', -1],
  ArrowRight: ['horizontal', 1],
  ArrowUp: ['vertical', -1],
  ArrowDown: ['vertical', 1],
};

/**
 * The caret move of an arrow, Home or End key: arrows by character,
 * mod or Alt with left and right by word, up and down by line, mod with up and down to the
 * text's ends, Home and End to the line's ends (⌘ with left and right on a Mac too); Shift
 * extends.
 *
 * @param event - The key.
 * @param platform - Which modifier is mod.
 * @returns The move, or undefined for another key.
 */
function motionOf(event: KeyEventLike, platform: KeyboardPlatform): CaretMotion | undefined {
  const isExtending = event.shiftKey;
  const isMod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  if (event.key === 'Home' || event.key === 'End') {
    return { unit: 'lineEdge', direction: event.key === 'Home' ? -1 : 1, isExtending };
  }
  const arrow = ARROWS[event.key];
  if (arrow === undefined) return undefined;
  const [axis, direction] = arrow;
  if (axis === 'vertical') return { unit: isMod ? 'textEdge' : 'line', direction, isExtending };
  if (isMod && platform === 'mac') return { unit: 'lineEdge', direction, isExtending };
  const isWord = isMod || event.altKey;
  return { unit: isWord ? 'word' : 'character', direction, isExtending };
}

/**
 * What a key does in the text editor, beyond typing (which arrives as input events): caret
 * moves, select all, undo and redo, Escape, mod+b / mod+i / mod+u, mod+shift+x, and Tab and
 * Shift+Tab for a list's level when the text edited is in a list (elsewhere Tab keeps
 * its own meaning). Keys an input method is composing with are the input method's. Pure.
 *
 * @param event - The key, with `isComposing`.
 * @param platform - Which modifier is mod.
 * @param editor - The editor, whose list Tab acts on; Tab is not the editor's without one.
 * @returns The action, or undefined when the key is typing or not the editor's.
 */
export function textKeyActionOf(
  event: KeyEventLike & { readonly isComposing: boolean; readonly keyCode?: number },
  platform: KeyboardPlatform,
  editor?: EditorState,
): TextKeyAction | undefined {
  if (isImeKey(event) || event.key === 'Process') return undefined;
  if (event.key === 'Escape') return { kind: 'escape' };
  const motion = motionOf(event, platform);
  if (motion !== undefined) return { kind: 'move', motion };
  const isMod = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const isInList = editor !== undefined && selectionListOf(editor) !== 'none';
  if (event.key === 'Tab' && !isMod && !event.altKey && isInList) {
    return { kind: event.shiftKey ? 'outdentList' : 'indentList' };
  }
  if (!isMod) return undefined;
  switch (event.key.toLowerCase()) {
    case 'a':
      return { kind: 'selectAll' };
    case 'b':
      return { kind: 'toggleBold' };
    case 'i':
      return { kind: 'toggleItalic' };
    case 'u':
      return { kind: 'toggleUnderline' };
    case 'x':
      // Without Shift, mod+x is cut: the browser's.
      return event.shiftKey ? { kind: 'toggleStrikethrough' } : undefined;
    case 'z':
      return { kind: event.shiftKey ? 'redo' : 'undo' };
    case 'y':
      return platform === 'mac' ? undefined : { kind: 'redo' };
    default:
      return undefined;
  }
}
