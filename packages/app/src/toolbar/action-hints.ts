import { formatAriaKeyShortcut, formatChord } from '../shortcuts/chord-format.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import type { ToolButtonHint } from './dock-button.js';

/** Each registry's hints by action (its JSON), built once per registry. */
const HINTS_BY_REGISTRY = new WeakMap<
  ShortcutRegistry<ShellAction>,
  ReadonlyMap<string, ToolButtonHint>
>();

/**
 * The hint of every action a registry's shortcuts dispatch, from each action's first shortcut
 * and chord: built once per registry, so a render looks hints up instead of scanning the
 * registry for every button.
 *
 * @param registry - The shell's shortcuts.
 * @returns The hints, by `JSON.stringify` of the action.
 */
function hintsOf(registry: ShortcutRegistry<ShellAction>): ReadonlyMap<string, ToolButtonHint> {
  const cached = HINTS_BY_REGISTRY.get(registry);
  if (cached !== undefined) return cached;
  const hints = new Map<string, ToolButtonHint>();
  for (const entry of registry.entries) {
    const key = JSON.stringify(entry.action);
    const [chord] = entry.parsedChords;
    if (hints.has(key) || chord === undefined) continue;
    hints.set(key, {
      label: formatChord(chord, registry.platform),
      ariaKeyShortcuts: formatAriaKeyShortcut(chord),
    });
  }
  HINTS_BY_REGISTRY.set(registry, hints);
  return hints;
}

/**
 * The hint of the first shortcut dispatching an action: what a dock button or a shell bar
 * button shows and announces as its shortcut.
 *
 * @param registry - The shell's shortcuts.
 * @param action - The action; none for a button without one.
 * @returns The hint, or undefined when no shortcut dispatches it.
 */
export function actionHint(
  registry: ShortcutRegistry<ShellAction>,
  action: ShellAction | undefined,
): ToolButtonHint | undefined {
  return action === undefined ? undefined : hintsOf(registry).get(JSON.stringify(action));
}
