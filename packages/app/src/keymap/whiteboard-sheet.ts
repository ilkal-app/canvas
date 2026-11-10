import { parseChord } from '../shortcuts/chord.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShortcutEntry, ShortcutGroup } from '../shortcuts/shortcut-registry.js';

// The `?` sheet on a floating whiteboard: the whiteboard's own shortcuts, its tools in
// the dock's order with Pan's Space hold and the keys the sticky tool and the Reactions flyout
// take, and none of the design tools' rows. The keys of the
// rows it leaves out stay bound (they say a whiteboard has no such panel); only the sheet hides
// them.

/** The Tools group's rows, in the dock's order, with the keys that go with a tool. */
const WHITEBOARD_TOOL_ORDER: readonly string[] = [
  'tools.select',
  'tools.pan',
  'tools.section',
  'tools.shapes',
  'tools.image',
  'tools.text',
  'tools.connector',
  'tools.draw',
  'tools.draw-eraser',
  'tools.sticky',
  'tools.stack-sticky',
  'tools.comment',
  'tools.reactions',
];

/** The rows of what a floating whiteboard does not have: the inspector, layers, components, vector edit and the developer overlay. */
const NOT_ON_A_WHITEBOARD: ReadonlySet<string> = new Set([
  'navigation.toggleInspector',
  'navigation.layers-drawer',
  'arrangement.createComponent',
  'selection.deleteAndHeal',
  'help.developer-overlay',
]);

/** Keys a row shows that are held, not shortcuts: Space pans while held (engine/space-pan-binding.ts). */
const HELD_KEYS: Readonly<Record<string, readonly string[]>> = { 'tools.pan': ['space'] };

/**
 * Rows of keys a tool takes while it is on, not shortcuts (the coordinator's ruling):
 * each follows its tool's row. The sticky tool's Enter places a note at the view's centre and
 * starts editing it; in the Reactions flyout, Enter or Space sends the focused emoji there.
 */
const TOOL_KEY_ROWS: readonly {
  readonly after: string;
  readonly id: string;
  readonly description: string;
  readonly keys: readonly string[];
}[] = [
  {
    after: 'tools.sticky',
    id: 'tools.sticky-place',
    description: 'Place a sticky at the centre (sticky tool on)',
    keys: ['enter'],
  },
  {
    after: 'tools.reactions',
    id: 'tools.reactions-send',
    description: 'Send the focused reaction (Reactions open)',
    keys: ['enter', 'space'],
  },
];

/**
 * A tool's entries with the rows of the keys it takes while on after it ({@link TOOL_KEY_ROWS}):
 * each a copy of the tool's entry under its own id, description and keys (the sheet only shows
 * them; nothing dispatches a row).
 *
 * @param entries - The Tools group's entries, in order.
 * @param platform - The platform the keys are shown for.
 * @returns The entries with the key rows.
 */
function withToolKeyRows<TAction>(
  entries: readonly ShortcutEntry<TAction>[],
  platform: KeyboardPlatform,
): ShortcutEntry<TAction>[] {
  return entries.flatMap((entry) => [
    entry,
    ...TOOL_KEY_ROWS.filter((row) => row.after === entry.id).map((row) => ({
      ...entry,
      id: row.id,
      description: row.description,
      chords: row.keys,
      parsedChords: row.keys.map((key) => parseChord(key, platform)),
    })),
  ]);
}

/**
 * The sheet's groups for a floating whiteboard: the design tools' rows left out, the Tools group
 * in the dock's order (rows the order does not name after it), and Pan's Space hold beside its
 * H. Pure.
 *
 * @param groups - The registry's groups (`listShortcuts`).
 * @param platform - The platform the keys are shown for.
 * @returns The whiteboard's groups.
 */
export function whiteboardSheetOf<TAction>(
  groups: readonly ShortcutGroup<TAction>[],
  platform: KeyboardPlatform,
): ShortcutGroup<TAction>[] {
  return groups
    .map((group) => {
      const entries = group.entries
        .filter((entry) => !NOT_ON_A_WHITEBOARD.has(entry.id))
        .map((entry) => {
          const held = HELD_KEYS[entry.id];
          if (held === undefined) return entry;
          return {
            ...entry,
            parsedChords: [...entry.parsedChords, ...held.map((key) => parseChord(key, platform))],
          };
        });
      if (group.category !== 'tools') return { ...group, entries };
      const rank = (id: string): number => {
        const index = WHITEBOARD_TOOL_ORDER.indexOf(id);
        return index === -1 ? WHITEBOARD_TOOL_ORDER.length : index;
      };
      const ordered = [...entries].sort((a, b) => rank(a.id) - rank(b.id));
      return { ...group, entries: withToolKeyRows(ordered, platform) };
    })
    .filter((group) => group.entries.length > 0);
}
