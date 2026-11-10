import type { EngineInspection } from '../engine/engine-document.js';
import type { ParsedChord } from '../shortcuts/chord.js';
import { listShortcuts, type ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import { isEditingAction } from '../state/editing-actions.js';
import type { ArrangeCommand, SelectionCommand, ShellAction } from '../state/shell-action.js';

/** What the context menu needs to know about the selection it opens on. */
export interface ContextMenuSelection {
  /** How many objects are selected; 0 on empty canvas. */
  readonly count: number;
  /** Whether a group is among them, so ungroup applies. */
  readonly hasGroup: boolean;
}

/**
 * The context menu's view of the engine's selection.
 *
 * @param inspection - What the engine reports: the selected objects.
 * @returns How many are selected and whether a group is among them.
 */
export function contextMenuSelectionOf(
  inspection: Pick<EngineInspection, 'selectedObjects'>,
): ContextMenuSelection {
  const { selectedObjects } = inspection;
  return {
    count: selectedObjects.length,
    hasGroup: selectedObjects.some((object) => object.type === 'group'),
  };
}

/** One command in the context menu. */
export interface ContextMenuEntry {
  /** The shortcut's id (`selection.duplicate`), unique in the menu. */
  readonly id: string;
  /** What the entry says: the shortcut's description. */
  readonly label: string;
  /** The shortcut's primary chord, shown beside the label; undefined when it has none. */
  readonly chord: ParsedChord | undefined;
  /** What choosing it dispatches: the very action its shortcut dispatches. */
  readonly action: ShellAction;
}

/** A run of entries between separators: one cheat sheet category. */
export interface ContextMenuSection {
  /** The category's heading (`Arrangement`), for the section's accessible name. */
  readonly label: string;
  /** The entries, in the registry's order. */
  readonly entries: readonly ContextMenuEntry[];
}

/** Whether a command applies to a selection of this shape. */
type Applies = (selection: ContextMenuSelection) => boolean;

const NEVER: Applies = () => false;
const ON_EMPTY: Applies = ({ count }) => count === 0;
const ONE_OR_MORE: Applies = ({ count }) => count >= 1;
const TWO_OR_MORE: Applies = ({ count }) => count >= 2;
const THREE_OR_MORE: Applies = ({ count }) => count >= 3;

/**
 * When each selection command is offered: on empty canvas, what the
 * board offers (select all, paste); with a selection, the commands on it, and selecting everything
 * of the same type. Deselect is Escape's; cropping an image fill is the paint control's
 * button; activate (Enter) and bold and italic
 * (mod+b, mod+i) are the text editor's keys and apply only to text, which the menu does not
 * know of the selection; Shift+Delete heals only in vector edit. Every command is listed, so a new one fails to type-check until it
 * is placed.
 */
const SELECTION_COMMANDS: Readonly<Record<SelectionCommand, Applies>> = {
  selectAll: ON_EMPTY,
  selectSameType: ONE_OR_MORE,
  deselect: NEVER,
  delete: ONE_OR_MORE,
  deleteAndHeal: NEVER,
  duplicate: ONE_OR_MORE,
  copy: ONE_OR_MORE,
  cut: ONE_OR_MORE,
  paste: ON_EMPTY,
  toggleLock: ONE_OR_MORE,
  activate: NEVER,
  cropImageFill: NEVER,
  toggleBold: NEVER,
  toggleItalic: NEVER,
  toggleUnderline: NEVER,
  toggleStrikethrough: NEVER,
};

/**
 * When each arrangement command is offered: order and create component
 * on anything selected; group, align and tidy up from two objects; distribute from
 * three; ungroup when a group is selected.
 */
const ARRANGE_COMMANDS: Readonly<Record<ArrangeCommand, Applies>> = {
  group: TWO_OR_MORE,
  ungroup: ({ hasGroup }) => hasGroup,
  createComponent: ONE_OR_MORE,
  bringForward: ONE_OR_MORE,
  sendBackward: ONE_OR_MORE,
  bringToFront: ONE_OR_MORE,
  sendToBack: ONE_OR_MORE,
  alignLeft: TWO_OR_MORE,
  alignCentre: TWO_OR_MORE,
  alignRight: TWO_OR_MORE,
  alignTop: TWO_OR_MORE,
  alignMiddle: TWO_OR_MORE,
  alignBottom: TWO_OR_MORE,
  distributeHorizontally: THREE_OR_MORE,
  distributeVertically: THREE_OR_MORE,
  tidyUp: TWO_OR_MORE,
  // Shift+N under the floating dock only; not a menu entry.
  stackSticky: NEVER,
};

/**
 * Whether the context menu offers an action for a selection: selection and arrangement
 * commands that apply to it; never another kind of action (nudges, history, tools). Pure.
 *
 * @param action - A shortcut's action.
 * @param selection - The selection the menu opens on.
 * @returns True when the menu lists it.
 */
export function isOfferedFor(action: ShellAction, selection: ContextMenuSelection): boolean {
  if (action.type === 'selection') return SELECTION_COMMANDS[action.command](selection);
  if (action.type === 'arrange') return ARRANGE_COMMANDS[action.command](selection);
  return false;
}

/**
 * The context menu's contents for a selection: the shortcut
 * registry's selection and arrangement commands that apply to it, grouped by cheat sheet
 * category in the registry's order, each with its label, its primary chord and the action its
 * shortcut dispatches. The menu follows the registry, so a command registered later appears
 * without touching the menu. For a person who cannot edit it offers no editing command
 * (`isEditingAction`): select all, select same type and copy remain. Pure.
 *
 * @param registry - The shell's shortcuts.
 * @param selection - The selection the menu opens on.
 * @param canEdit - Whether the person may edit the board; true if absent.
 * @returns The non-empty sections, in order.
 */
export function contextMenuSections(
  registry: ShortcutRegistry<ShellAction>,
  selection: ContextMenuSelection,
  canEdit = true,
): ContextMenuSection[] {
  return listShortcuts(registry)
    .map((group) => ({
      label: group.label,
      entries: group.entries
        .filter(
          ({ action }) => isOfferedFor(action, selection) && (canEdit || !isEditingAction(action)),
        )
        .map((entry): ContextMenuEntry => ({
          id: entry.id,
          label: entry.description,
          chord: entry.parsedChords[0],
          action: entry.action,
        })),
    }))
    .filter(({ entries }) => entries.length > 0);
}
