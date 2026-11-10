import { useId, type ReactElement } from 'react';

import type { BoardObject } from '@canvas/schema';

import {
  contextMenuSections,
  type ContextMenuEntry,
} from '../context-menu/context-menu-entries.js';
import { Tooltip } from '../feedback/tooltip.js';
import { usePopup } from '../focus/use-popup.js';
import { Icon } from '../icons/icon.js';
import { formatChord } from '../shortcuts/chord-format.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import { actionHint } from '../toolbar/action-hints.js';

import styles from './inspector-header.module.css';

/** The lock's action: the selection's lock, as its shortcut (⇧⌘L) and the context menu run it. */
const TOGGLE_LOCK: ShellAction = { type: 'selection', command: 'toggleLock' };

/** Props of {@link InspectorHeaderActions}. */
export interface InspectorHeaderActionsProps {
  /** The selected objects as stored, primary first. */
  readonly selection: readonly BoardObject[];
  /** The shell's shortcuts, whose chords the lock and the menu show. */
  readonly shortcuts: ShortcutRegistry<ShellAction>;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * Whether every selected object is locked: the header's lock shows pressed and the
 * inspector's sections are disabled. False with nothing selected.
 *
 * @param selection - The selected objects.
 * @returns True when there is a selection and every object in it is locked.
 */
export function isSelectionLocked(selection: readonly BoardObject[]): boolean {
  return selection.length > 0 && selection.every((object) => object.locked);
}

/**
 * The "more" menu's entries: the selection commands the context menu offers for what is
 * selected (duplicate, copy, cut, delete, select all of the same type; select all and paste
 * with nothing selected), without the lock, which the header shows as its own button. A locked
 * selection is offered only what changes nothing (copy, select all of the same type), as every
 * section and arrange action is disabled for it (item 6).
 *
 * @param shortcuts - The shell's shortcuts.
 * @param selection - The selected objects.
 * @returns The entries, in the keymap's order.
 */
export function moreMenuEntries(
  shortcuts: ShortcutRegistry<ShellAction>,
  selection: readonly BoardObject[],
): ContextMenuEntry[] {
  const hasGroup = selection.some((object) => object.type === 'group');
  const isLocked = isSelectionLocked(selection);
  return contextMenuSections(shortcuts, { count: selection.length, hasGroup })
    .flatMap((section) => section.entries)
    .filter(
      ({ action }) =>
        action.type === 'selection' &&
        action.command !== 'toggleLock' &&
        (!isLocked || LOCKED_SELECTION_COMMANDS.has(action.command)),
    );
}

/** The "more" menu's commands for a locked selection: those that change nothing on the board. */
const LOCKED_SELECTION_COMMANDS: ReadonlySet<string> = new Set(['copy', 'selectSameType']);

/**
 * The header's lock: a toggle bound to `toggleLock` (⇧⌘L), pressed while every
 * selected object is locked, its tooltip "Lock" or "Unlock" with the shortcut. A press keeps the
 * focus where it was.
 *
 * @param props - The selection, the shortcuts and the dispatch.
 * @returns The button.
 */
function LockButton(props: InspectorHeaderActionsProps): ReactElement {
  const isLocked = isSelectionLocked(props.selection);
  const hint = actionHint(props.shortcuts, TOGGLE_LOCK);
  return (
    <Tooltip text={isLocked ? 'Unlock' : 'Lock'} shortcut={hint?.label} placement="below-end">
      {(tooltipId) => (
        <button
          type="button"
          className={styles.button}
          aria-label={hint === undefined ? 'Lock' : `Lock (${hint.label})`}
          aria-describedby={tooltipId}
          aria-keyshortcuts={hint?.ariaKeyShortcuts}
          aria-pressed={isLocked}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            props.dispatch(TOGGLE_LOCK);
          }}
        >
          <Icon name={isLocked ? 'lock' : 'unlock'} />
        </button>
      )}
    </Tooltip>
  );
}

/**
 * The header's "more" menu: a WAI-ARIA menu button (`usePopup`) whose menu offers the
 * selection commands of the context menu with their shortcuts; choosing one closes the menu and
 * dispatches the very action its shortcut does.
 *
 * @param props - The selection, the shortcuts and the dispatch.
 * @returns The button and, when open, the menu.
 */
function MoreMenu(props: InspectorHeaderActionsProps): ReactElement {
  const popup = usePopup();
  const menuId = useId();
  const entries = moreMenuEntries(props.shortcuts, props.selection);
  return (
    <div className={styles.anchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.button}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? menuId : undefined}
        onClick={popup.toggle}
        onKeyDown={popup.onTriggerKeyDown}
      >
        <Icon name="more" />
      </button>
      {popup.isOpen && (
        <div
          ref={popup.popupRef}
          id={menuId}
          role="menu"
          aria-label="More"
          className={styles.menu}
          onKeyDown={popup.onPopupKeyDown}
        >
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.menuItem}
              data-popup-item=""
              onClick={() => {
                popup.close();
                props.dispatch(entry.action);
              }}
            >
              <span className={styles.menuLabel}>{entry.label}</span>
              {entry.chord === undefined ? null : (
                <span className={styles.menuHint}>
                  {formatChord(entry.chord, props.shortcuts.platform)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The inspector header's actions (Figma "Inspector by selection"): with a selection,
 * the lock and the "more" menu; with nothing selected, the menu alone.
 *
 * @param props - The selection, the shortcuts and the dispatch.
 * @returns The actions.
 */
export function InspectorHeaderActions(props: InspectorHeaderActionsProps): ReactElement {
  return (
    <div className={styles.actions}>
      {props.selection.length > 0 && <LockButton {...props} />}
      <MoreMenu {...props} />
    </div>
  );
}
