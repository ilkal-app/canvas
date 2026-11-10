import { useEffect, useRef } from 'react';

import { isEditableTarget } from '../focus/editable-target.js';
import { isControlActivationKey, isInteractiveTarget } from '../focus/interactive-target.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import { matchShortcut, type ShortcutRegistry } from '../shortcuts/shortcut-registry.js';

/**
 * Binds a shortcut registry to `keydown` on `window`: a key press that matches a shortcut has
 * its default prevented and the shortcut's action dispatched. Keys are left alone when:
 * the target is editable (text fields, selects, contenteditable; the prototype's guard); the
 * key is Enter or Space and the target is a control those keys press (a button, link, menu
 * entry or toggle, so it keeps working from the keyboard); a
 * component already called `preventDefault` (a toolbar's arrow keys, a dialog's Escape); an IME
 * is composing; or the key is auto-repeating and the shortcut cannot repeat (the default is
 * still prevented then, so a held key does not fall through to the browser).
 *
 * @param registry - The shortcuts to match; the latest registry is always used.
 * @param dispatch - Receives the action of each pressed shortcut.
 * @param isEnabled - Whether to listen; false while a modal dialog owns the keyboard.
 */
export function useShortcuts<TAction>(
  registry: ShortcutRegistry<TAction>,
  dispatch: (action: TAction) => void,
  isEnabled = true,
): void {
  const registryRef = useRef(registry);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    registryRef.current = registry;
    dispatchRef.current = dispatch;
  }, [registry, dispatch]);

  useEffect(() => {
    if (!isEnabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isImeKey(event)) return;
      // Inside shadow DOM (an embedded SDK), `target` is the host; the path starts at the field.
      const target = event.composedPath()[0] ?? event.target;
      if (isEditableTarget(target)) return;
      // Enter and Space press a focused button, link, menu entry or toggle; a canvas shortcut
      // bound to them (Enter activates the selection) must not take them from the control.
      if (isControlActivationKey(event.key) && isInteractiveTarget(target)) return;
      const entry = matchShortcut(event, registryRef.current);
      if (entry === undefined) return;
      event.preventDefault();
      if (event.repeat && !entry.canRepeat) return;
      dispatchRef.current(entry.action);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEnabled]);
}
