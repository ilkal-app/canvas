import type { ToolId } from '@canvas/tools';

import { collectContributions, type ContributionModules } from '../shell/contributions.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShortcutCategory } from '../shortcuts/shortcut-category.js';
import {
  createShortcutRegistry,
  registerShortcut,
  type ShortcutDefinition,
  type ShortcutEntry,
  type ShortcutRegistry,
} from '../shortcuts/shortcut-registry.js';
import type {
  ArrangeCommand,
  NavigationCommand,
  NudgeDirection,
  SelectionCommand,
  ShellAction,
} from '../state/shell-action.js';
import { TOOL_LABELS } from '../state/tool-labels.js';
import {
  ARROW_VARIANT,
  CONNECTOR_VARIANT,
  DRAW_VARIANT,
  ELLIPSE_VARIANT,
  ERASER_VARIANT,
  LINE_VARIANT,
  RECTANGLE_VARIANT,
  toolVariantAction,
  type ToolVariant,
} from '../state/tool-variants.js';

type ShellShortcut = ShortcutDefinition<ShellAction>;

function entry(
  category: ShortcutCategory,
  name: string,
  chords: string[],
  description: string,
  action: ShellAction,
): ShellShortcut {
  return { id: `${category}.${name}`, chords, description, category, action };
}

function tool(id: ToolId, chord: string, variant?: ToolVariant): ShellShortcut {
  if (variant === undefined) {
    return entry('tools', id, [chord], TOOL_LABELS[id], { type: 'selectTool', tool: id });
  }
  const name = variant.label.toLowerCase();
  return entry('tools', name, [chord], variant.label, toolVariantAction(variant));
}

function navigate(
  command: NavigationCommand,
  chords: string[],
  description: string,
): ShellShortcut {
  return entry('navigation', command, chords, description, { type: 'navigate', command });
}

function select(command: SelectionCommand, chords: string[], description: string): ShellShortcut {
  return entry('selection', command, chords, description, { type: 'selection', command });
}

function arrange(command: ArrangeCommand, chords: string[], description: string): ShellShortcut {
  return entry('arrangement', command, chords, description, { type: 'arrange', command });
}

// Keyboard pan shares the arrows: a nudge moves the selection, and pans the view only
// while nothing is selected (packages/app/src/engine/engine-document.ts), so the description
// names both.
function nudge(direction: NudgeDirection, arrow: string, isLarge: boolean): ShellShortcut {
  const name = `nudge-${direction}${isLarge ? '-large' : ''}`;
  const description = `Nudge ${direction}${isLarge ? ' by 10 px' : ''}, or pan the view`;
  const chord = isLarge ? `shift+${arrow}` : arrow;
  return {
    ...entry('selection', name, [chord], description, { type: 'nudge', direction, isLarge }),
    canRepeat: true,
  };
}

const ARROWS: readonly [NudgeDirection, string][] = [
  ['up', 'arrowup'],
  ['down', 'arrowdown'],
  ['left', 'arrowleft'],
  ['right', 'arrowright'],
];

/**
 * Tells whether a value is a list of shortcut definitions, for the shortcut files the keymap
 * collects.
 *
 * @param value - An export of a shortcut file.
 * @returns True when it is an array of objects with an id, chords and an action.
 */
export function isShortcutList(
  value: unknown,
): value is readonly ShortcutDefinition<ShellAction>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Partial<ShellShortcut>).id === 'string' &&
        Array.isArray((item as Partial<ShellShortcut>).chords) &&
        typeof (item as Partial<ShellShortcut>).action === 'object',
    )
  );
}

/**
 * Every shortcut file of `keymap/contributions/`: a file named `<name>-shortcuts.ts` exporting
 * its definitions as `shortcuts`, for a task that adds a command with a key (such as select
 * same type) without editing the list below. Vite resolves the pattern when it builds.
 */
const CONTRIBUTED_SHORTCUT_MODULES: ContributionModules = import.meta.glob<
  Readonly<Record<string, unknown>>
>('./contributions/*-shortcuts.ts', { eager: true });

/**
 * The shortcuts of `keymap/contributions/`, in path order, after the core list; conflicts
 * with it or each other fail `createDefaultShortcutRegistry` (and its test).
 */
const CONTRIBUTED_SHORTCUTS: readonly ShellShortcut[] = collectContributions(
  CONTRIBUTED_SHORTCUT_MODULES,
  'shortcuts',
  isShortcutList,
).flat();

/**
 * The shell's default key bindings, covering the canvas's commands: tools (the hand, the ellipse
 * and the flyout items' variants since, every one in every board mode), navigation,
 * selection and arrangement, history, the cheat sheet and the developer overlay, then the shortcuts
 * of `keymap/contributions/`. Chords follow Figma's where a convention exists. Copy, cut and paste
 * are native: the browser's clipboard events carry them. Remapping will replace this list per
 * person.
 */
export const DEFAULT_SHORTCUTS: readonly ShortcutDefinition<ShellAction>[] = [
  tool('select', 'v'),
  tool('hand', 'h'),
  tool('text', 't'),
  tool('sticky', 's'),
  tool('pen', 'p'),
  // Figma's pencil chord; `p` stays the pen. It leaves the eraser for drawing.
  tool('draw', 'shift+p', DRAW_VARIANT),
  // Shift+E erases with the draw tool; `e` is free for the floating dock's reactions.
  tool('draw', 'shift+e', ERASER_VARIANT),
  tool('shape', 'r', RECTANGLE_VARIANT),
  tool('shape', 'o', ELLIPSE_VARIANT),
  tool('line', 'l', LINE_VARIANT),
  tool('line', 'shift+l', ARROW_VARIANT),
  tool('connector', 'c', CONNECTOR_VARIANT),
  tool('image', 'i'),
  tool('frame', 'f'),

  { ...navigate('zoomIn', ['mod+=', 'mod++', '=', '+'], 'Zoom in'), canRepeat: true },
  { ...navigate('zoomOut', ['mod+-', '-'], 'Zoom out'), canRepeat: true },
  navigate('zoomToActualSize', ['shift+0', 'mod+0'], 'Zoom to 100%'),
  navigate('zoomToFit', ['shift+1'], 'Zoom to fit'),
  navigate('zoomToSelection', ['shift+2'], 'Zoom to selection'),
  navigate('toggleGrid', ["mod+'"], 'Show or hide the grid'),
  navigate('toggleSnapping', ["mod+shift+'"], 'Turn snapping on or off'),
  navigate('toggleMinimap', ['shift+m'], 'Show or hide the minimap'),
  // Figma's Alt+8 shows its design panel; the inspector drawer is ours.
  entry('navigation', 'toggleInspector', ['alt+8'], 'Show or hide the inspector', {
    type: 'toggleInspector',
  }),
  navigate('previousPage', ['PageUp'], 'Previous page'),
  navigate('nextPage', ['PageDown'], 'Next page'),

  select('selectAll', ['mod+a'], 'Select all'),
  select('selectSameType', ['mod+alt+a'], 'Select all of the same type'),
  select('deselect', ['escape'], 'Deselect'),
  select('delete', ['delete', 'backspace'], 'Delete'),
  select(
    'deleteAndHeal',
    ['shift+delete', 'shift+backspace'],
    'Delete points and join their neighbours (vector edit)',
  ),
  select('duplicate', ['mod+d'], 'Duplicate'),
  { ...select('copy', ['mod+c'], 'Copy'), isNative: true },
  { ...select('cut', ['mod+x'], 'Cut'), isNative: true },
  { ...select('paste', ['mod+v'], 'Paste'), isNative: true },
  select('toggleLock', ['mod+shift+l'], 'Lock or unlock'),
  select('activate', ['enter'], 'Edit the selected object'),
  select('toggleBold', ['mod+b'], 'Bold'),
  select('toggleItalic', ['mod+i'], 'Italic'),
  select('toggleUnderline', ['mod+u'], 'Underline'),
  select('toggleStrikethrough', ['mod+shift+x'], 'Strikethrough'),
  ...ARROWS.map(([direction, arrow]) => nudge(direction, arrow, false)),
  ...ARROWS.map(([direction, arrow]) => nudge(direction, arrow, true)),

  arrange('group', ['mod+g'], 'Group'),
  arrange('ungroup', ['mod+shift+g'], 'Ungroup'),
  arrange('createComponent', ['mod+alt+k'], 'Create component'),
  arrange('bringForward', ['mod+]'], 'Bring forward'),
  arrange('sendBackward', ['mod+['], 'Send backward'),
  arrange('bringToFront', ['mod+alt+]'], 'Bring to front'),
  arrange('sendToBack', ['mod+alt+['], 'Send to back'),
  arrange('alignLeft', ['alt+a'], 'Align left'),
  arrange('alignCentre', ['alt+h'], 'Align horizontal centres'),
  arrange('alignRight', ['alt+d'], 'Align right'),
  arrange('alignTop', ['alt+w'], 'Align top'),
  arrange('alignMiddle', ['alt+v'], 'Align vertical centres'),
  arrange('alignBottom', ['alt+s'], 'Align bottom'),
  arrange('distributeHorizontally', ['alt+shift+h'], 'Distribute horizontally'),
  arrange('distributeVertically', ['alt+shift+v'], 'Distribute vertically'),
  arrange('tidyUp', ['ctrl+alt+t'], 'Tidy up'),

  {
    ...entry('history', 'undo', ['mod+z'], 'Undo', { type: 'history', command: 'undo' }),
    canRepeat: true,
  },
  {
    ...entry('history', 'redo', ['mod+shift+z'], 'Redo', { type: 'history', command: 'redo' }),
    canRepeat: true,
  },

  entry('help', 'cheat-sheet', ['?'], 'Show keyboard shortcuts', { type: 'toggleCheatSheet' }),
  entry('help', 'developer-overlay', ['mod+shift+d'], 'Show or hide the developer overlay', {
    type: 'toggleDeveloperOverlay',
  }),

  ...CONTRIBUTED_SHORTCUTS,
];

/**
 * Builds a registry holding {@link DEFAULT_SHORTCUTS} for a platform.
 *
 * @param platform - The platform whose meaning of `mod` applies.
 * @returns The registry.
 * @throws {Error} When two default shortcuts share a chord on this platform (a bug in the list).
 */
export function createDefaultShortcutRegistry(
  platform: KeyboardPlatform,
): ShortcutRegistry<ShellAction> {
  return DEFAULT_SHORTCUTS.reduce(
    (registry, definition) => registerShortcut(registry, definition),
    createShortcutRegistry<ShellAction>(platform),
  );
}

/**
 * Finds the shortcut that selects a tool, for the toolbar's hints.
 *
 * @param registry - The shell's shortcuts.
 * @param toolId - The tool.
 * @returns The first shortcut whose action selects the tool, or undefined when none does.
 */
export function findToolShortcut(
  registry: ShortcutRegistry<ShellAction>,
  toolId: ToolId,
): ShortcutEntry<ShellAction> | undefined {
  return registry.entries.find(
    ({ action }) => action.type === 'selectTool' && action.tool === toolId,
  );
}
