import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { useMenuMoves } from '../focus/typeahead.js';
import { POPUP_ITEM_ATTRIBUTE } from '../focus/use-popup.js';

import { AnchoredPopover, type PopoverCloseReason } from './anchored-popover.js';
import { MenuItemContents } from './menu-item-contents.js';
import styles from './menu.module.css';
import type { PlacementAlign, PlacementSide, ScreenRect } from './placement.js';
import { useOnVisible } from './use-on-visible.js';

/** An action in a {@link Menu}, or a choice in a `CompactDropdown`'s menu. */
export interface MenuItemEntry {
  /** `item` acts or opens a submenu; `radio` is one choice of several; `checkbox` is on or off. */
  readonly kind: 'item' | 'radio' | 'checkbox';
  /** Unique in its menu. */
  readonly id: string;
  /** Its name. */
  readonly label: string;
  /** Words at its end: a shortcut (`⌘⇧H`), a value (`16`) or what a submenu holds. */
  readonly meta?: string | undefined;
  /** Inline style for its name: a font's own face in a font menu. */
  readonly labelStyle?: CSSProperties | undefined;
  /**
   * Called once it first scrolls into view (a font loading its preview); at once where
   * the browser cannot tell.
   */
  readonly onVisible?: (() => void) | undefined;
  /** Whether it destroys something (Delete board): the red pencil's words. */
  readonly isDanger?: boolean | undefined;
  /** Whether it can't be chosen now: announced, faded to 38%. */
  readonly isDisabled?: boolean | undefined;
  /**
   * For a choice or a checkbox, whether it is the current one or on: a check before it in a
   * compact menu, at the row's end for a checkbox of the default menu.
   */
  readonly isChecked?: boolean | undefined;
  /** Its submenu, if it opens one (›) instead of acting. */
  readonly submenu?: readonly MenuEntry[] | undefined;
  /** Called when it is chosen; the menu has closed. */
  readonly onSelect?: (() => void) | undefined;
}

/** A rule between groups of a {@link Menu}. */
export interface MenuSeparatorEntry {
  /** A separator. */
  readonly kind: 'separator';
  /** Unique in its menu. */
  readonly id: string;
}

/** One line of a {@link Menu}. */
export type MenuEntry = MenuItemEntry | MenuSeparatorEntry;

/** Props of {@link Menu}. */
export interface MenuProps {
  /** Its accessible name ("Board menu"). */
  readonly label: string;
  /** Its lines, in order. */
  readonly entries: readonly MenuEntry[];
  /** What it opens from: an element (its button) or a rectangle. */
  readonly anchor: ScreenRect | RefObject<Element | null>;
  /** Whether it is open. */
  readonly isOpen: boolean;
  /**
   * Asked to close it: an item was chosen (`choose`; focus is back where it was), Escape, Tab,
   * a press outside or another popup opening.
   */
  readonly onClose: (reason: MenuCloseReason) => void;
  /** The side it opens on; `bottom` if absent. */
  readonly side?: PlacementSide | undefined;
  /** How it lines up with its anchor; `start` if absent. */
  readonly align?: PlacementAlign | undefined;
  /** Space between it and its anchor, px; 4 if absent. */
  readonly gap?: number | undefined;
  /** What takes focus when it opens; its first item if absent. */
  readonly initialFocus?: 'checked' | 'first' | 'last' | undefined;
  /** `compact` for a dropdown's menu (a check column, values at the end); `default` if absent. */
  readonly variant?: 'default' | 'compact' | undefined;
  /** Whether it is another menu's submenu: the arrow back toward its item closes it. */
  readonly isSubmenu?: boolean | undefined;
  /**
   * Content after its items, outside the arrow keys' list: the font size menu's Custom field.
   * Tab reaches it; Escape closes the menu from it.
   */
  readonly footer?: ReactNode | undefined;
  /** The most its list may take, px, scrolling beyond (the font menu); unbounded if absent. */
  readonly maxListHeight?: number | undefined;
  /** Areas of the window it must not cover (the dock, the zoom control); none if absent. */
  readonly reserved?: readonly ScreenRect[] | undefined;
}

/** What can take focus in a menu's footer. */
const FOOTER_FOCUSABLE = 'input:not(:disabled), button:not(:disabled), [tabindex="0"]';

/** Why a {@link Menu} asked to close. */
export type MenuCloseReason = PopoverCloseReason | 'choose' | 'tab';

/** What each initial focus asks for, inside the menu. */
const INITIAL_FOCUS: Readonly<Record<'checked' | 'first' | 'last', string>> = {
  checked: `[${POPUP_ITEM_ATTRIBUTE}][aria-checked="true"]`,
  first: `[${POPUP_ITEM_ATTRIBUTE}]`,
  last: `[${POPUP_ITEM_ATTRIBUTE}]:last-of-type`,
};

/**
 * The menu's items, in order.
 *
 * @param list - The menu's list.
 * @returns Its own items, not a submenu's.
 */
function itemsOf(list: HTMLElement | null): HTMLElement[] {
  if (list === null) return [];
  return [...list.querySelectorAll<HTMLElement>(`[${POPUP_ITEM_ATTRIBUTE}]`)].filter(
    (item) => item.closest('[data-menu-list]') === list,
  );
}

/**
 * Whether a key opens a submenu, or goes back from one, in the item's direction.
 *
 * @param event - The key.
 * @param toward - `in` for opening, `out` for going back.
 * @returns Whether it does.
 */
function isSubmenuKey(event: KeyboardEvent<HTMLElement>, toward: 'in' | 'out'): boolean {
  const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const inward = isRtl ? 'ArrowLeft' : 'ArrowRight';
  const outward = isRtl ? 'ArrowRight' : 'ArrowLeft';
  return event.key === (toward === 'in' ? inward : outward);
}

/** What one item needs from its list. */
interface MenuItemRowProps {
  readonly entry: MenuItemEntry;
  readonly variant: 'default' | 'compact';
  readonly openSubmenuId: string | undefined;
  readonly onOpenSubmenu: (id: string | undefined) => void;
  readonly onChoose: (entry: MenuItemEntry) => void;
  readonly onDismiss: (reason: MenuCloseReason) => void;
}

/**
 * One item: a button out of the Tab order that the arrows reach, its name, its meta at the
 * end, a check column in a compact menu (a checked checkbox of the default menu has its check
 * after the meta), and its submenu while open.
 *
 * @param props - The entry and the list's handlers.
 * @returns The item.
 */
function MenuItemRow(props: MenuItemRowProps): ReactElement {
  const { entry, variant, openSubmenuId } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const hasSubmenu = entry.submenu !== undefined;
  const isSubmenuOpen = hasSubmenu && openSubmenuId === entry.id;
  const role = entry.kind === 'item' ? 'menuitem' : (`menuitem${entry.kind}` as const);
  useOnVisible(ref, entry.onVisible);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (hasSubmenu && isSubmenuKey(event, 'in')) {
      event.preventDefault();
      event.stopPropagation();
      props.onOpenSubmenu(entry.id);
    }
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        role={role}
        tabIndex={-1}
        className={styles.item}
        data-variant={variant}
        data-danger={entry.isDanger === true ? '' : undefined}
        aria-checked={role === 'menuitem' ? undefined : entry.isChecked === true}
        aria-disabled={entry.isDisabled === true ? true : undefined}
        aria-haspopup={hasSubmenu ? 'menu' : undefined}
        aria-expanded={hasSubmenu ? isSubmenuOpen : undefined}
        {...{ [POPUP_ITEM_ATTRIBUTE]: '' }}
        onKeyDown={onKeyDown}
        onPointerEnter={() => {
          props.onOpenSubmenu(hasSubmenu ? entry.id : undefined);
        }}
        onClick={() => {
          if (entry.isDisabled === true) return;
          if (hasSubmenu) props.onOpenSubmenu(entry.id);
          else props.onChoose(entry);
        }}
      >
        <MenuItemContents entry={entry} variant={variant} hasSubmenu={hasSubmenu} />
      </button>
      {entry.submenu === undefined ? null : (
        <Menu
          label={entry.label}
          entries={entry.submenu}
          anchor={ref}
          isOpen={isSubmenuOpen}
          side={getSubmenuSide(ref.current)}
          align="start"
          gap={2}
          isSubmenu
          onClose={(reason) => {
            props.onOpenSubmenu(undefined);
            // Chosen, gone outside or tabbed away: the whole menu closes; Escape or the arrow
            // back leaves the parent open, focus on this item.
            if (reason === 'choose' || reason === 'tab' || reason === 'outside') {
              props.onDismiss(reason);
            }
          }}
        />
      )}
    </>
  );
}

/**
 * The side a submenu opens on: after its item in the page's direction.
 *
 * @param item - The item.
 * @returns `right` in a left-to-right page, `left` in a right-to-left one.
 */
function getSubmenuSide(item: HTMLElement | null): PlacementSide {
  return item !== null && getComputedStyle(item).direction === 'rtl' ? 'left' : 'right';
}

/**
 * A {@link Menu}'s state: its list, its open submenu, and what closing and its keys do.
 *
 * @param props - The menu's props.
 * @returns Its list ref, open submenu, closer, chooser and key handler.
 */
function useMenuState(props: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string>();
  const openerRef = useRef<HTMLElement | null>(null);
  // Where focus was as it opens (its popover moves focus in only once placed, after this).
  useLayoutEffect(() => {
    if (!props.isOpen) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
  }, [props.isOpen]);
  const dismiss = (reason: MenuCloseReason): void => {
    setOpenSubmenuId(undefined);
    // Chosen, or Escape and the arrow back: focus goes back to what opened it.
    const isFocusReturned = reason === 'choose' || reason === 'escape';
    if (isFocusReturned && openerRef.current?.isConnected === true) openerRef.current.focus();
    props.onClose(reason);
  };
  const moves = useMenuMoves();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      event.stopPropagation();
      // Into the footer's field (the font size's Custom) first, where the menu has one.
      const footerField = event.shiftKey
        ? null
        : footerRef.current?.querySelector<HTMLElement>(FOOTER_FOCUSABLE);
      if (footerField !== null && footerField !== undefined) {
        event.preventDefault();
        footerField.focus();
        return;
      }
      // Focus moves on as Tab moves it; every level closes once.
      dismiss('tab');
      return;
    }
    if (props.isSubmenu === true && isSubmenuKey(event, 'out')) {
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
      return;
    }
    const items = itemsOf(listRef.current);
    const focused = items.findIndex((item) => item === document.activeElement);
    // Letters typed move to the item they start, as the arrows move.
    const move = moves(event, items, focused);
    if (move === undefined || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (move.next !== undefined) items[move.next]?.focus();
  };
  const choose = (entry: MenuItemEntry): void => {
    dismiss('choose');
    entry.onSelect?.();
  };
  // Tab on from the footer leaves the menu; Shift+Tab goes back to its items.
  const onFooterKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    if (!event.shiftKey) {
      dismiss('tab');
      return;
    }
    const item =
      listRef.current?.querySelector<HTMLElement>(INITIAL_FOCUS.checked) ??
      listRef.current?.querySelector<HTMLElement>(INITIAL_FOCUS.first);
    if (item === null || item === undefined) return;
    event.preventDefault();
    item.focus();
  };
  return {
    listRef,
    footerRef,
    openSubmenuId,
    setOpenSubmenuId,
    dismiss,
    choose,
    onKeyDown,
    onFooterKeyDown,
  };
}

/**
 * A menu (the design's board menu and font size menu): a stack-shaped
 * `AnchoredPopover` with `role="menu"` (a dialog round a `menu` list and its footer's field), items with a right-aligned meta (a shortcut, a value,
 * or a submenu's ›), danger items in the danger ink, separators and submenus. Keys follow
 * WAI-ARIA's menu pattern: the arrows, Home and End move (wrapping), Enter and Space choose,
 * the arrow toward the page's end opens a submenu and the one back (or Escape) closes it with
 * focus on its item; Escape closes the menu with focus back where it was; Tab closes it and
 * moves on. Choosing closes every level and then runs the item. On a touch screen its rows are
 * 48 px. It takes the popup stack; a submenu is its child there.
 *
 * @param props - Its name, lines, anchor, state, handler and placement.
 * @returns The menu, or nothing while closed.
 */
export function Menu(props: MenuProps): ReactElement | null {
  const { entries, variant = 'default' } = props;
  const {
    listRef,
    footerRef,
    openSubmenuId,
    setOpenSubmenuId,
    dismiss,
    choose,
    onKeyDown,
    onFooterKeyDown,
  } = useMenuState(props);
  return (
    <AnchoredPopover
      anchor={props.anchor}
      isOpen={props.isOpen}
      label={props.label}
      role={props.footer === undefined ? 'menu' : 'dialog'}
      shape="stack"
      side={props.side ?? 'bottom'}
      align={props.align ?? 'start'}
      gap={props.gap ?? 4}
      reserved={props.reserved}
      initialFocus={INITIAL_FOCUS[props.initialFocus ?? 'first']}
      onClose={dismiss}
    >
      <div
        ref={listRef}
        className={styles.list}
        data-menu-list=""
        {...(props.footer === undefined ? {} : { role: 'menu', 'aria-label': props.label })}
        data-variant={variant}
        style={
          props.maxListHeight === undefined
            ? undefined
            : { maxHeight: `${String(props.maxListHeight)}px`, overflowY: 'auto' }
        }
        onKeyDown={onKeyDown}
      >
        {entries.map((entry) =>
          entry.kind === 'separator' ? (
            <div key={entry.id} role="separator" className={styles.separator} />
          ) : (
            <MenuItemRow
              key={entry.id}
              entry={entry}
              variant={variant}
              openSubmenuId={openSubmenuId}
              onOpenSubmenu={setOpenSubmenuId}
              onChoose={choose}
              onDismiss={dismiss}
            />
          ),
        )}
      </div>
      {props.footer === undefined ? null : (
        <div ref={footerRef} onKeyDown={onFooterKeyDown}>
          {props.footer}
        </div>
      )}
    </AnchoredPopover>
  );
}
