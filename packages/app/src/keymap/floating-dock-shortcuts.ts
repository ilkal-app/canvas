import type { ShortcutDefinition } from '../shortcuts/shortcut-registry.js';
import {
  FLOATING_DOCK_TOOL_IDS,
  FLOATING_DOCK_TOOLS,
  type FloatingDockToolId,
} from '../state/floating-dock.js';

/** A key of the floating whiteboard dock: a tool's, or stacking a sticky. */
export type FloatingDockShortcut =
  | {
      /** Chooses a dock tool. */
      readonly kind: 'tool';
      /** Stable identifier, `tools.<tool>`. */
      readonly id: string;
      /** The key. */
      readonly chord: string;
      /** Other keys that choose it too (Draw's Shift+P). */
      readonly otherChords: readonly string[];
      /** What the cheat sheet calls it: the tool's name. */
      readonly description: string;
      /** The tool. */
      readonly tool: FloatingDockToolId;
    }
  | {
      /**
       * Places the next sticky directly below the selected one, in its colour.
       */
      readonly kind: 'stackSticky';
      /** Stable identifier, `tools.stack-sticky`. */
      readonly id: string;
      /** The key. */
      readonly chord: string;
      /** What the cheat sheet calls it. */
      readonly description: string;
    };

/** The chord that stacks a sticky below the selected one (the panel hint's tooltip). */
export const STACK_STICKY_CHORD = 'shift+n';

/**
 * The floating dock's keys, in dock order, then Shift+N: one single letter per tool (V, H, F;
 * S, I, T, C, P; N, M, E), from `FLOATING_DOCK_TOOLS`.
 */
export const FLOATING_DOCK_SHORTCUTS: readonly FloatingDockShortcut[] = [
  ...FLOATING_DOCK_TOOL_IDS.map((tool): FloatingDockShortcut => ({
    kind: 'tool',
    id: `tools.${tool}`,
    chord: FLOATING_DOCK_TOOLS[tool].chord,
    otherChords: FLOATING_DOCK_TOOLS[tool].otherChords ?? [],
    description: FLOATING_DOCK_TOOLS[tool].label,
    tool,
  })),
  {
    kind: 'stackSticky',
    id: 'tools.stack-sticky',
    chord: STACK_STICKY_CHORD,
    description: 'Stack a sticky note below the selected one',
  },
];

/**
 * The shortcut list under the floating chrome: the given list without the classic dock's tool
 * keys (R, O, L, Shift+L and the rest: by default every `tools` shortcut, else those
 * `isReplaced` picks, so a contributed `tools` shortcut that is not a tool choice can be kept),
 * then the floating dock's keys in that category, each with the action `actionOf` gives it; a
 * key whose action is `undefined` (a tool not built yet) is left out. Neither input is changed.
 * Registering the result throws on any clash, so the floating keys are checked against every
 * other shortcut, contributed ones included. Pure.
 *
 * @template TAction - The action type the shortcuts dispatch.
 * @param shortcuts - The full list (the shell's `DEFAULT_SHORTCUTS`).
 * @param actionOf - The action each floating dock key dispatches, or `undefined` for none.
 * @param isReplaced - Whether a shortcut of the list is a classic tool key the floating keys
 *   replace; every `tools` shortcut when absent.
 * @returns The list.
 */
export function withFloatingDockShortcuts<TAction>(
  shortcuts: readonly ShortcutDefinition<TAction>[],
  actionOf: (shortcut: FloatingDockShortcut) => TAction | undefined,
  isReplaced: (shortcut: ShortcutDefinition<TAction>) => boolean = (shortcut) =>
    shortcut.category === 'tools',
): ShortcutDefinition<TAction>[] {
  const floating: ShortcutDefinition<TAction>[] = [];
  for (const shortcut of FLOATING_DOCK_SHORTCUTS) {
    const action = actionOf(shortcut);
    if (action === undefined) continue;
    floating.push({
      id: shortcut.id,
      chords: [shortcut.chord, ...(shortcut.kind === 'tool' ? shortcut.otherChords : [])],
      description: shortcut.description,
      category: 'tools',
      action,
    });
  }
  return [...shortcuts.filter((shortcut) => !isReplaced(shortcut)), ...floating];
}
