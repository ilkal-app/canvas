import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import {
  createShortcutRegistry,
  registerShortcut,
  type ShortcutDefinition,
  type ShortcutRegistry,
} from '../shortcuts/shortcut-registry.js';
import { isDesignOnlyAction } from '../state/design-only-actions.js';
import { DRAW_ERASER_KEY_ACTION, floatingDockKeyAction } from '../state/floating-dock-actions.js';
import type { ShellAction } from '../state/shell-action.js';

import { DEFAULT_SHORTCUTS } from './default-keymap.js';
import { withFloatingDockShortcuts } from './floating-dock-shortcuts.js';

/**
 * The shell's shortcuts on a whiteboard under the floating chrome: `DEFAULT_SHORTCUTS`
 * with the classic tool choices (every `tools` shortcut that selects a tool) replaced by the
 * floating dock's keys, V H F, S I T C P, N M, each a built tool's (`floatingDockKeyAction`;
 * Draw keeps the classic draw key Shift+P too). P (and Shift+P) chooses Draw and, while drawing,
 * cycles pencil, marker and highlighter, and Shift+E chooses the eraser while drawing only.
 * E opens Reactions, or while drawing chooses the eraser as Shift+E does
 * (`useCommentKeyDispatch`). Shift+N stacks a note below the selected one. Mod+F
 * opens board search in place of the browser's find, and mod+/ moves focus into the
 * selection's properties popover. A whiteboard has no components, so Create component
 * (mod+alt+k) is not among them: with it go its key and its context menu entry, which
 * the menu takes from these shortcuts.
 */
export const FLOATING_SHORTCUTS: readonly ShortcutDefinition<ShellAction>[] = [
  ...withFloatingDockShortcuts(
    DEFAULT_SHORTCUTS.filter(({ action }) => !isDesignOnlyAction(action)),
    (shortcut): ShellAction | undefined =>
      shortcut.kind === 'tool'
        ? floatingDockKeyAction(shortcut.tool)
        : { type: 'arrange', command: 'stackSticky' },
    (shortcut) => shortcut.category === 'tools' && shortcut.action.type === 'selectTool',
  ),
  {
    id: 'tools.draw-eraser',
    chords: ['shift+e'],
    description: 'Eraser, while drawing',
    category: 'tools',
    action: DRAW_ERASER_KEY_ACTION,
  },
  {
    id: 'navigation.board-search',
    chords: ['mod+f'],
    description: 'Search the board',
    category: 'navigation',
    action: { type: 'openBoardSearch' },
  },
  {
    id: 'selection.focus-popover',
    chords: ['mod+/'],
    description: "Focus the selection's properties",
    category: 'selection',
    action: { type: 'focusSelectionPopover' },
  },
];

/**
 * Builds a registry holding {@link FLOATING_SHORTCUTS} for a platform.
 *
 * @param platform - The platform whose meaning of `mod` applies.
 * @returns The registry.
 * @throws {Error} When two of the shortcuts share a chord on this platform (a bug in the list).
 */
export function createFloatingShortcutRegistry(
  platform: KeyboardPlatform,
): ShortcutRegistry<ShellAction> {
  return FLOATING_SHORTCUTS.reduce(
    (registry, definition) => registerShortcut(registry, definition),
    createShortcutRegistry<ShellAction>(platform),
  );
}
