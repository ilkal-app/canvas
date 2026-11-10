import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { notAvailableName } from '../controls/not-available.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';

import type { ToolButtonHint } from './dock-button.js';
import styles from './dock.module.css';

/** One choice of a {@link DockMenu}. */
export interface DockMenuItem {
  /** Unique within the menu. */
  readonly id: string;
  /** Its name. */
  readonly label: string;
  /** A line under the name (a board mode's tools), if any. */
  readonly description?: string;
  /** Its icon. */
  readonly icon: IconName;
  /** Its shortcut, shown at the end, if any. */
  readonly hint?: ToolButtonHint | undefined;
  /** Whether it is the one in use (`aria-checked`). */
  readonly isChecked: boolean;
  /** Whether it can be chosen; a disabled one says "not available yet" and does nothing. */
  readonly isAvailable: boolean;
}

/** Props of {@link DockMenu}. */
export interface DockMenuProps {
  /** The menu's accessible name (`Shapes`, `Board mode`). */
  readonly label: string;
  /** A heading shown above the items (`Board mode`), if any. */
  readonly heading?: string;
  /** A note shown under the items, if any. */
  readonly footer?: ReactNode;
  /** The items, in order. */
  readonly items: readonly DockMenuItem[];
  /** Called with the item chosen (a click, Enter or Space); the menu then closes. */
  readonly onChoose: (id: string) => void;
  /** Closes the menu: Escape, Tab, a press outside it; focus goes back to its button. */
  readonly onClose: (isFocusReturned: boolean) => void;
}

/**
 * A menu that opens above a dock button (a flyout, the mode switcher): `role="menu"` with an
 * item per choice (`menuitemradio`, the one in use checked). Focus moves to the checked item (the
 * first if none) when it opens; ArrowUp and ArrowDown move between items (wrapping), Home and End
 * to the ends, Enter and Space choose, Escape closes with focus back on the button, Tab closes,
 * and a press outside closes it. Its keys never reach the canvas's shortcuts.
 *
 * @param props - Its name, items and handlers.
 * @returns The menu.
 */
export function DockMenu(props: DockMenuProps): ReactElement {
  const { items, onChoose, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = menuRef.current;
    const entries = menu === null ? [] : menuItemsOf(menu);
    const checked = entries.find((entry) => entry.getAttribute('aria-checked') === 'true');
    (checked ?? entries[0])?.focus();
  }, []);
  useCloseOnOutsidePress(menuRef, onClose);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={props.label}
      className={styles.menu}
      onKeyDown={(event) => {
        moveInMenu(event, onClose);
      }}
    >
      {props.heading !== undefined && (
        <div className={styles.menuHeading} aria-hidden="true">
          {props.heading}
        </div>
      )}
      {items.map((item) => (
        <MenuEntry key={item.id} item={item} onChoose={onChoose} />
      ))}
      {props.footer !== undefined && <div className={styles.menuFooter}>{props.footer}</div>}
    </div>
  );
}

/**
 * One item of a {@link DockMenu}.
 *
 * @param props - The item and where a choice goes.
 * @param props.item - The item.
 * @param props.onChoose - Receives its id when chosen.
 * @returns The item.
 */
function MenuEntry(props: {
  readonly item: DockMenuItem;
  readonly onChoose: (id: string) => void;
}): ReactElement {
  const { item, onChoose } = props;
  const descriptionId = useId();
  const name = item.isAvailable ? item.label : notAvailableName(item.label);
  return (
    <div
      role="menuitemradio"
      tabIndex={-1}
      className={styles.menuItem}
      aria-checked={item.isChecked}
      aria-disabled={item.isAvailable ? undefined : true}
      aria-label={item.hint === undefined ? name : `${name} (${item.hint.label})`}
      aria-keyshortcuts={item.hint?.ariaKeyShortcuts}
      aria-describedby={item.description === undefined ? undefined : descriptionId}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        if (item.isAvailable) onChoose(item.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (item.isAvailable) onChoose(item.id);
      }}
    >
      <Icon name={item.icon} />
      <span className={styles.menuText}>
        <span className={styles.menuLabel}>{name}</span>
        {item.description !== undefined && (
          <span id={descriptionId} className={styles.menuDescription}>
            {item.description}
          </span>
        )}
      </span>
      {item.hint !== undefined && (
        <kbd className={styles.hint} aria-hidden="true">
          {item.hint.label}
        </kbd>
      )}
      {item.isChecked && <Icon name="check" />}
    </div>
  );
}

/**
 * A menu's items, in order.
 *
 * @param menu - The menu.
 * @returns Its items.
 */
function menuItemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
}

/**
 * Where a key moves focus within a menu: the arrows wrap, Home and End go to the ends.
 *
 * @param key - The key.
 * @param index - The item focused now.
 * @param count - How many items there are.
 * @returns The item to focus, or undefined for a key that moves nothing.
 */
function menuMove(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * A menu's keys: the arrows, Home and End move focus, Escape closes with focus returned, Tab
 * closes. Every other key is kept from the canvas's shortcuts too (their listener is on the
 * window), so R or Delete pressed in an open flyout neither switches the tool nor deletes the
 * selection; Enter and Space still press the focused item.
 *
 * @param event - The key.
 * @param onClose - Closes the menu.
 */
function moveInMenu(event: KeyboardEvent, onClose: (isFocusReturned: boolean) => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose(true);
    return;
  }
  if (event.key === 'Tab') {
    onClose(false);
    return;
  }
  const entries = menuItemsOf(event.currentTarget as HTMLElement);
  const index = entries.findIndex((entry) => entry === document.activeElement);
  const next = menuMove(event.key, Math.max(index, 0), entries.length);
  event.stopPropagation();
  if (next === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  entries[next]?.focus();
}

/**
 * Closes a menu when a press lands outside it and outside the dock slot it opened from (whose
 * own button's click toggles or chooses instead).
 *
 * @param menuRef - The menu.
 * @param onClose - Closes it.
 */
function useCloseOnOutsidePress(
  menuRef: RefObject<HTMLElement | null>,
  onClose: (isFocusReturned: boolean) => void,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      const slot = menuRef.current?.parentElement ?? null;
      if (slot !== null && event.target instanceof Node && !slot.contains(event.target)) {
        onCloseRef.current(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [menuRef]);
}
