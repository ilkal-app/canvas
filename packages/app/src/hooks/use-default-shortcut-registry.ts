import { useMemo } from 'react';

import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { detectKeyboardPlatform, type KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

/**
 * The shell's default shortcuts for a platform, built once per platform and dock: the given
 * platform, or the browser's (`detectKeyboardPlatform` on the user agent) if absent; the floating
 * whiteboard dock's keys in place of the classic tool keys when it shows. Main thread.
 *
 * @param platform - The keyboard convention (`mac`: ⌘; `other`: Ctrl); detected if absent.
 * @param isFloatingDock - Whether the floating whiteboard dock shows; false if absent.
 * @returns The registry of `DEFAULT_SHORTCUTS`, or of `FLOATING_SHORTCUTS`.
 */
export function useDefaultShortcutRegistry(
  platform?: KeyboardPlatform,
  isFloatingDock = false,
): ShortcutRegistry<ShellAction> {
  return useMemo(() => {
    const resolved = platform ?? detectKeyboardPlatform(navigator.userAgent);
    return isFloatingDock
      ? createFloatingShortcutRegistry(resolved)
      : createDefaultShortcutRegistry(resolved);
  }, [platform, isFloatingDock]);
}
