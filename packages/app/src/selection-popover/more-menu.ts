import type { BoardObject } from '@canvas/schema';

import type { MenuEntry, MenuItemEntry } from '../controls/menu.js';
import { isSelectionLocked } from '../panels/inspector-header.js';
import { exportEntriesOf, type FloatingBoardExport } from '../shell/floating-board-menu.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import { actionHint } from '../toolbar/action-hints.js';

/** One action of the more menu: its name and what it dispatches. */
type MoreAction = readonly [label: string, action: ShellAction];

/**
 * The menu item for an action, its shortcut at the end.
 *
 * @param shortcuts - The shell's shortcuts.
 * @param dispatch - Runs the action.
 * @param entry - The action's name and action.
 * @param fields - More of the item (danger, disabled).
 * @returns The item.
 */
function itemOf(
  shortcuts: ShortcutRegistry<ShellAction>,
  dispatch: (action: ShellAction) => void,
  entry: MoreAction,
  fields: Partial<MenuItemEntry> = {},
): MenuItemEntry {
  const [label, action] = entry;
  return {
    kind: 'item',
    id: label,
    label,
    meta: actionHint(shortcuts, action)?.label,
    onSelect: () => {
      dispatch(action);
    },
    ...fields,
  };
}

/** What the more menu can do beyond shell actions, where the shell offers it. */
export interface SelectionMoreExtras {
  /** Exports the selection, as the board menu's Export does; `'pending'` keeps its row disabled. */
  readonly export?: FloatingBoardExport | 'pending' | undefined;
  /** Copies a link that opens the board with the primary selected object selected. */
  readonly onCopyLink?: (() => void) | undefined;
}

/**
 * The selection popover's more (⋯) menu: Duplicate; Copy link to object; Lock or
 * Unlock; Bring forward, Send backward, Bring to front, Send to back; Group (two or more) or
 * Ungroup (a group among them); Export; and Delete, in the red pencil. Each runs the
 * shell action its keyboard shortcut runs and shows that shortcut. A locked selection offers
 * only Copy link, Unlock and Export: everything else would change it. Copy link and Export
 * (the board menu's PNG 1×, PNG 2× and PDF submenu, for the selection) show only where the shell
 * offers them, so nothing shows that cannot work. Pure.
 *
 * @param selection - The selected objects.
 * @param shortcuts - The shell's shortcuts, for each item's shortcut.
 * @param dispatch - Runs an item's action.
 * @param extras - Export and Copy link, where the shell offers them.
 * @returns The menu's lines.
 */
export function selectionMoreEntries(
  selection: readonly BoardObject[],
  shortcuts: ShortcutRegistry<ShellAction>,
  dispatch: (action: ShellAction) => void,
  extras: SelectionMoreExtras = {},
): readonly MenuEntry[] {
  const item = (entry: MoreAction, fields?: Partial<MenuItemEntry>): MenuItemEntry =>
    itemOf(shortcuts, dispatch, entry, fields);
  const isLocked = isSelectionLocked(selection);
  const { onCopyLink } = extras;
  const copyLink: MenuItemEntry[] =
    onCopyLink === undefined
      ? []
      : [
          {
            kind: 'item',
            id: 'Copy link to object',
            label: 'Copy link to object',
            onSelect: onCopyLink,
          },
        ];
  const exported = exportEntriesOf(extras.export);
  const lock = item([isLocked ? 'Unlock' : 'Lock', { type: 'selection', command: 'toggleLock' }]);
  if (isLocked) {
    return [...copyLink, lock, ...exported];
  }
  const hasGroup = selection.some((object) => object.type === 'group');
  const grouping: MenuEntry[] = [];
  if (selection.length > 1) grouping.push(item(['Group', { type: 'arrange', command: 'group' }]));
  if (hasGroup) grouping.push(item(['Ungroup', { type: 'arrange', command: 'ungroup' }]));
  // One sticky note: the next note below it (item 4), as Shift+N does, which a touch
  // screen has no key for.
  const [only] = selection;
  const stacking =
    selection.length === 1 && only?.type === 'sticky'
      ? [item(['Add note below', { type: 'arrange', command: 'stackSticky' }])]
      : [];
  return [
    item(['Duplicate', { type: 'selection', command: 'duplicate' }]),
    ...stacking,
    ...copyLink,
    lock,
    { kind: 'separator', id: 'order' },
    item(['Bring forward', { type: 'arrange', command: 'bringForward' }]),
    item(['Send backward', { type: 'arrange', command: 'sendBackward' }]),
    item(['Bring to front', { type: 'arrange', command: 'bringToFront' }]),
    item(['Send to back', { type: 'arrange', command: 'sendToBack' }]),
    ...(grouping.length > 0 ? [{ kind: 'separator', id: 'group' } as const, ...grouping] : []),
    { kind: 'separator', id: 'out' },
    ...exported,
    item(['Delete', { type: 'selection', command: 'delete' }], { isDanger: true }),
  ];
}
