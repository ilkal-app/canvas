import type { ShortcutDefinition } from '../../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../../state/shell-action.js';

/**
 * The layers drawer's shortcut: Alt+1 (Option+1 on a Mac), Figma's own for its layers
 * panel, opens the drawer and moves focus into it, and closes it, focus going back. No core
 * shortcut and no dock key uses Alt with a digit; the digit row matches by position, so the
 * character Option+1 types on a Mac (`¡`) or a layout's own still presses it.
 */
export const shortcuts: readonly ShortcutDefinition<ShellAction>[] = [
  {
    id: 'navigation.layers-drawer',
    chords: ['alt+1'],
    description: 'Show or hide layers',
    category: 'navigation',
    action: { type: 'toggleLayersDrawer' },
  },
];
