import { useEffect } from 'react';

import { isEditableTarget } from '../focus/editable-target.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import { detectKeyboardPlatform } from '../shortcuts/keyboard-platform.js';

/** The link shortcut as `aria-keyshortcuts` names it on each platform. */
export const LINK_SHORTCUT = { mac: 'Meta+K', other: 'Control+K' } as const;

/**
 * Whether a key is the link shortcut, ⌘K on a Mac and Ctrl+K elsewhere, with no other
 * modifier.
 *
 * @param event - The key.
 * @returns True for it.
 */
export function isLinkShortcut(event: KeyboardEvent): boolean {
  const isMac = detectKeyboardPlatform(navigator.userAgent) === 'mac';
  const isMod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return isMod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';
}

/**
 * Opens a link dialog on the link shortcut, from anywhere on the page while `onPress`
 * is given, in the capture phase (the text editor's input keeps its keys from the window), and
 * keeps the browser's own meaning of the keys from running. A key in a field (a comment, a
 * dialog's own field) is the field's, unless `isFromTextEditor` says the text being edited has
 * it.
 *
 * @param onPress - Opens the dialog; nothing listens while absent.
 * @param isFromTextEditor - Whether a key from an editable element is the edited text's (the
 *   editing popover's); a key in a field is left alone if absent.
 */
export function useLinkShortcut(
  onPress: (() => void) | undefined,
  isFromTextEditor?: (target: EventTarget | null) => boolean,
): void {
  useEffect(() => {
    if (onPress === undefined) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isLinkShortcut(event) || isImeKey(event)) return;
      const { target } = event;
      if (isEditableTarget(target) && isFromTextEditor?.(target) !== true) return;
      event.preventDefault();
      event.stopPropagation();
      onPress();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onPress, isFromTextEditor]);
}
