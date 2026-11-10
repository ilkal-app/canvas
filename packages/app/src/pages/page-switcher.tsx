import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';

import type { ObjectId } from '@canvas/schema';

import { FloatingSheet } from '../controls/floating-sheet.js';
import type { NoticeAction } from '../hooks/use-notice.js';
import { Icon } from '../icons/icon.js';
import type { ShellAction } from '../state/shell-action.js';

import type { PageNavigation } from './page-navigator.js';
import styles from './page-switcher.module.css';
import { ADD_PAGE_ROW_ATTRIBUTE, addPageAndShow, PagesPanel } from './pages-panel.js';
import { usePages } from './use-pages.js';

/** The attribute on the pages trigger, whose press the open sheet leaves to its toggle. */
const PAGES_TRIGGER_ATTRIBUTE = 'data-pages-trigger';

/** What the whiteboard's page list works with besides the pages themselves. */
export interface PageListSource {
  /** Whether the person may edit the board: a viewer only switches pages. */
  readonly canEdit: boolean;
  /** The selection, which a page's "Move selection here" moves. */
  readonly selectedIds: readonly ObjectId[];
  /** Shows a notice, with a button: Undo after a delete, Go to after a move. */
  readonly onNotice: (message: string, action?: NoticeAction) => void;
}

/** Props of {@link AddPageButton}. */
export interface AddPageButtonProps {
  /** The pages, or undefined before an engine mounts. */
  readonly pages: PageNavigation | undefined;
  /** Whether the person may edit the board: no button otherwise. */
  readonly canEdit: boolean;
  /**
   * The bar's icon button class on a phone's compact bar, where the button is its glyph alone;
   * absent on the desktop bar, where it reads "Add page".
   */
  readonly compactClassName?: string | undefined;
}

/**
 * The floating board bar's last control on a one-page board ("move
 * the add page to the end"): Add page, after the board menu, for a person who may edit; it adds a
 * page after the others and shows it. Before an engine mounts it is there already, disabled, so
 * the bar keeps its size as the board loads (as the board menu keeps Export's row).
 *
 * @param props - The pages, the role and the compact class.
 * @returns The button, or null for a viewer.
 */
export function AddPageButton(props: AddPageButtonProps): ReactElement | null {
  const { pages } = usePages(props.pages);
  if (!props.canEdit) return null;
  const isCompact = props.compactClassName !== undefined;
  return (
    <button
      type="button"
      className={props.compactClassName ?? styles.add}
      aria-label={isCompact ? 'Add page' : undefined}
      title="Add page"
      disabled={pages.length === 0}
      onClick={() => {
        addPageAndShow(props.pages);
      }}
    >
      <Icon name="plus" />
      {isCompact ? null : <span>Add page</span>}
    </button>
  );
}

/** Props of {@link PagesTrigger}. */
export interface PagesTriggerProps {
  /** The page shown's name. */
  readonly name: string;
  /** Whether the page list is open. */
  readonly isOpen: boolean;
  /** Opens or closes the page list. */
  readonly onToggle: () => void;
}

/**
 * The page dropdown, the floating board bar's last control from two pages on (owner,
 * 2026-10-28: "shouldnt the page dropdown be where the add page is showing?"): the page shown's
 * name and a caret; a press drops the page list down under it, right-aligned. Its tooltip
 * holds the name whole and the keys that step pages.
 *
 * @param props - The name and the list's state.
 * @returns The trigger.
 */
export function PagesTrigger(props: PagesTriggerProps): ReactElement {
  const { name } = props;
  return (
    <button
      type="button"
      className={styles.trigger}
      aria-label={`Pages, ${name}`}
      title={`${name} (PageUp / PageDown)`}
      aria-haspopup="dialog"
      aria-expanded={props.isOpen}
      {...{ [PAGES_TRIGGER_ATTRIBUTE]: '' }}
      onClick={props.onToggle}
    >
      <span className={styles.triggerName}>{name}</span>
      {/* A text caret: the subtitle's line is smaller than the one icon size (icon-usage.test). */}
      <span aria-hidden="true">▾</span>
    </button>
  );
}

/**
 * Where the sheet opens: 8 px under the board bar, its right edge on the page dropdown's (the
 * bar's right edge when the list opened from the board menu), measured again whenever the bar
 * changes size: a rename from the list widens the dropdown, and the list follows it.
 *
 * @param barRef - The board bar.
 * @returns The sheet's place, once the bar is measured.
 */
function useUnderDropdown(barRef: RefObject<HTMLElement | null>): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (bar === null) return undefined;
    const place = (): void => {
      const box = bar.getBoundingClientRect();
      const anchor = bar.querySelector(`[${PAGES_TRIGGER_ATTRIBUTE}]`)?.getBoundingClientRect();
      const right = document.documentElement.clientWidth - (anchor ?? box).right;
      setStyle((was) =>
        was?.right === right && was.top === box.bottom + 8 ? was : { right, top: box.bottom + 8 },
      );
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
    };
  }, [barRef]);
  return style;
}

/**
 * Moves focus one item down or up the list: the page rows, then Add page; it stops at either end.
 *
 * @param sheet - The sheet.
 * @param step - 1 for down, -1 for up.
 */
function moveFocus(sheet: HTMLElement, step: 1 | -1): void {
  const items = [...sheet.querySelectorAll<HTMLElement>(`li, [${ADD_PAGE_ROW_ATTRIBUTE}]`)];
  const at = items.findIndex((item) => item === document.activeElement);
  const next = at < 0 ? 0 : Math.min(Math.max(at + step, 0), items.length - 1);
  items[next]?.focus();
}

/**
 * Gives focus back after Escape: to the page dropdown.
 *
 * @param barRef - The board bar.
 */
function returnFocus(barRef: RefObject<HTMLElement | null>): void {
  barRef.current?.querySelector<HTMLElement>(`[${PAGES_TRIGGER_ATTRIBUTE}]`)?.focus();
}

/** Props of {@link PagesSheet}. */
export interface PagesSheetProps {
  /** The board bar, which the sheet opens under. */
  readonly barRef: RefObject<HTMLElement | null>;
  /** The pages, or undefined before an engine mounts. */
  readonly pages: PageNavigation | undefined;
  /** The role, the selection and the notice. */
  readonly source: PageListSource;
  /** The shell's dispatch, whose undo a deletion's notice runs. */
  readonly dispatch: (action: ShellAction) => void;
  /** Whether the bar is the phone's compact one: wider, with 44 px rows. */
  readonly isCompact: boolean;
  /** Closes the sheet. */
  readonly onClose: () => void;
}

/**
 * The whiteboard's page list: the design board's list (`PagesPanel`: show, add, rename,
 * reorder, duplicate, move the selection, delete) in a sheet under the board bar; a
 * double-click on the page shown renames it, the sheet staying open. Deleting asks
 * nothing: the notice says what went and offers Undo, one step that brings
 * the page and its objects back. It has no heading: Add page is its last row.
 * Focus goes to the page shown's row as it opens, the arrow keys move between the rows and Add
 * page, and Enter takes one; showing
 * a page, Escape (focus back to the trigger) or a press outside closes
 * it.
 *
 * @param props - The bar, the pages, the role, the dispatch and the close handler.
 * @returns The sheet.
 */
export function PagesSheet(props: PagesSheetProps): ReactElement {
  const { onClose, dispatch, source, barRef } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus into the list: the page shown's row.
    sheetRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, []);
  useEffect(() => {
    const closeByKey = (): void => {
      onClose();
      returnFocus(barRef);
    };
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || sheetRef.current?.contains(target) === true) return;
      if (target.closest(`[${PAGES_TRIGGER_ATTRIBUTE}]`) !== null) return;
      onClose();
    };
    // Escape with focus outside the sheet (on the trigger that opened it), caught before the
    // shell's own keys; inside it, the sheet's handler hears what a rename or a menu leaves.
    const closeOnEscape = (event: KeyboardEvent): void => {
      const target = event.target;
      if (event.key !== 'Escape') return;
      if (target instanceof Node && sheetRef.current?.contains(target) === true) return;
      event.preventDefault();
      event.stopPropagation();
      closeByKey();
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [onClose, barRef]);
  return (
    <FloatingSheet
      ref={sheetRef}
      shape="stack"
      role="dialog"
      label="Pages"
      className={styles.sheet}
      style={useUnderDropdown(props.barRef)}
      dataAttributes={props.isCompact ? { 'data-compact': '' } : undefined}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
        returnFocus(barRef);
      }}
    >
      <PagesPanel
        pages={props.pages}
        canEdit={source.canEdit}
        selectedIds={source.selectedIds}
        onNotice={source.onNotice}
        onUndoDelete={() => {
          dispatch({ type: 'history', command: 'undo' });
        }}
        onShow={onClose}
        addPageAs="row"
      />
    </FloatingSheet>
  );
}
