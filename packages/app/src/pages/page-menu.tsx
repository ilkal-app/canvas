import { useEffect, useRef, type ReactElement } from 'react';

import type { Page } from '@canvas/schema';

import styles from './pages-panel.module.css';

/** What a page's menu can do. */
export interface PageMenuChoices {
  /** Starts renaming the page. */
  readonly rename: () => void;
  /** Copies the page. */
  readonly duplicate: () => void;
  /** Asks to delete the page; undefined while it is the only page. */
  readonly remove: (() => void) | undefined;
  /** Moves the selection to the page; undefined with nothing selected or on the page shown. */
  readonly moveSelection: (() => void) | undefined;
}

/** Props of {@link PageMenu}. */
export interface PageMenuProps {
  /** The page. */
  readonly page: Page;
  /** Where it opens, CSS px from the viewport's top-left. */
  readonly at: { readonly x: number; readonly y: number };
  /** The choices. */
  readonly choices: PageMenuChoices;
  /** Closes it. */
  readonly onClose: () => void;
}

/**
 * A page's context menu in the page list: rename, duplicate, delete (disabled
 * for the only page), and move the selection to the page. Focus goes to its first item; Escape,
 * a choice or a press outside closes it.
 *
 * @param props - The page, the place, the choices and the close handler.
 * @returns The menu.
 */
export function PageMenu(props: PageMenuProps): ReactElement {
  const { page, at, choices, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector('button')?.focus();
    const close = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
    };
  }, [onClose]);
  const item = (label: string, run: (() => void) | undefined): ReactElement => (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      disabled={run === undefined}
      onClick={() => {
        onClose();
        run?.();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Page ${page.name}`}
      className={styles.menu}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      {item('Rename page', choices.rename)}
      {item('Duplicate page', choices.duplicate)}
      {item('Move selection here', choices.moveSelection)}
      {item('Delete page', choices.remove)}
    </div>
  );
}
