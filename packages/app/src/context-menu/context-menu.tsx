import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import type { ContextMenuRequest } from '../engine/mounted-engine.js';
import { nextRovingIndex } from '../focus/roving-index.js';
import { formatAriaKeyShortcut, formatChord } from '../shortcuts/chord-format.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';
import type { ShellAction } from '../state/shell-action.js';

import type { ContextMenuSection } from './context-menu-entries.js';
import styles from './context-menu.module.css';

/** Props of {@link ContextMenu}. */
export interface ContextMenuProps {
  /** What it offers (`contextMenuSections`), separated by section; at least one entry. */
  readonly sections: readonly ContextMenuSection[];
  /** Where it opens, CSS px in the viewport; it is moved back inside the viewport if needed. */
  readonly position: ContextMenuRequest;
  /** The platform whose chord symbols to show. */
  readonly platform: KeyboardPlatform;
  /** Called with an entry's action when the person chooses it; the menu then closes. */
  readonly onChoose: (action: ShellAction) => void;
  /** Called when the menu closes without a choice, and after a choice. */
  readonly onClose: () => void;
}

/** The gap kept between the menu and the viewport's edges, CSS px. */
const EDGE_GAP_PX = 8;

/**
 * Keeps the menu inside the viewport: a menu opened near the right or bottom edge opens to the
 * left or upwards of the point instead.
 *
 * @param menu - The menu element, laid out at the requested point.
 * @param position - The requested point.
 */
function fitInViewport(menu: HTMLElement, position: ContextMenuRequest): void {
  const { width, height } = menu.getBoundingClientRect();
  const left = Math.max(EDGE_GAP_PX, Math.min(position.clientX, innerWidth - width - EDGE_GAP_PX));
  const top = Math.max(EDGE_GAP_PX, Math.min(position.clientY, innerHeight - height - EDGE_GAP_PX));
  menu.style.left = `${String(left)}px`;
  menu.style.top = `${String(top)}px`;
}

/**
 * Where each section's first entry falls among all the menu's entries, for roving focus.
 *
 * @param sections - The sections.
 * @returns One index per section.
 */
function firstEntryIndexes(sections: readonly ContextMenuSection[]): number[] {
  const indexes: number[] = [];
  let next = 0;
  for (const section of sections) {
    indexes.push(next);
    next += section.entries.length;
  }
  return indexes;
}

/**
 * Closes the menu on a press anywhere outside it, and returns focus
 * where it was when the menu opened.
 *
 * @param menuRef - The menu element.
 * @param onClose - Closes the menu.
 */
function useCloseOnOutsidePress(
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  const [focusBeforeOpen] = useState(() => document.activeElement);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (focusBeforeOpen instanceof HTMLElement) focusBeforeOpen.focus();
    };
  }, [menuRef, focusBeforeOpen]);
}

/**
 * The canvas's context menu: the
 * commands that apply to the selection, each with its shortcut's chord, opened at a long-press
 * or a secondary click. Choosing an entry dispatches the same action its shortcut does. A WAI-ARIA
 * menu: focus moves to the first entry on open; the arrow keys, Home and End move between
 * entries, Enter or Space chooses one; Escape, Tab and a press outside close it, and focus
 * returns where it was.
 *
 * @param props - The entries, where it opens, the platform and the callbacks.
 * @returns The menu.
 */
export function ContextMenu(props: ContextMenuProps): ReactElement {
  const { sections, position, platform, onChoose, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const entries = sections.flatMap((section) => section.entries);
  useCloseOnOutsidePress(menuRef, onClose);
  useLayoutEffect(() => {
    if (menuRef.current) fitInViewport(menuRef.current, position);
  }, [position]);
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    const focused = itemRefs.current.findIndex((item) => item === document.activeElement);
    const next = nextRovingIndex(event.key, Math.max(0, focused), entries.length);
    if (next === undefined) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  };

  const firstIndexOf = firstEntryIndexes(sections);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Canvas"
      className={styles.menu}
      style={{ left: position.clientX, top: position.clientY }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {sections.map((section, sectionIndex) => (
        <Fragment key={section.label}>
          {sectionIndex > 0 && <div role="separator" className={styles.separator} />}
          {section.entries.map((entry, entryIndex) => {
            const itemIndex = (firstIndexOf[sectionIndex] ?? 0) + entryIndex;
            return (
              <button
                key={entry.id}
                ref={(element) => {
                  itemRefs.current[itemIndex] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={itemIndex === 0 ? 0 : -1}
                className={styles.item}
                aria-keyshortcuts={entry.chord && formatAriaKeyShortcut(entry.chord)}
                onClick={() => {
                  onChoose(entry.action);
                  onClose();
                }}
              >
                <span>{entry.label}</span>
                {entry.chord && (
                  <span className={styles.chord}>{formatChord(entry.chord, platform)}</span>
                )}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
