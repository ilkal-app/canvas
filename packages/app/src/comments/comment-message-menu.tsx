import { useEffect, useId, type ReactElement } from 'react';

import type { PopupControl } from '../focus/use-popup.js';
import { Icon } from '../icons/icon.js';

import styles from './comments.module.css';

/** The event a comment card's menu sends as it opens, naming itself, so any other one closes. */
const MENU_OPENED = 'canvas-comment-menu-opened';

/**
 * Keeps one of a comment card's "…" menus open at a time: the thread's and each
 * message's. As this one opens it says so, and while it is open another one's opening closes it,
 * leaving focus where the other put it.
 *
 * @param popup - This menu's popup.
 */
export function useOnlyCommentMenuOpen(popup: PopupControl): void {
  const id = useId();
  const { isOpen, toggle } = popup;
  useEffect(() => {
    if (!isOpen) return undefined;
    document.dispatchEvent(new CustomEvent<string>(MENU_OPENED, { detail: id }));
    const onOther = (event: Event): void => {
      if ((event as CustomEvent<string>).detail !== id) toggle();
    };
    document.addEventListener(MENU_OPENED, onOther);
    return () => {
      document.removeEventListener(MENU_OPENED, onOther);
    };
  }, [id, isOpen, toggle]);
}

/**
 * A message's own "…" (item 16), for a message the person may delete: a menu holding
 * "Delete message", which asks in the message's row (`MessageItem`). The thread's "…" holds Delete
 * thread alone.
 *
 * @param props - Its popup, whether a request runs and what Delete message does.
 * @param props.popup - Its popup, the row's: Cancel puts focus back on its button.
 * @param props.isBusy - Whether a request is running.
 * @param props.onDelete - Asks to delete the message.
 * @returns The button and, open, its menu.
 */
export function MessageMenu(props: {
  readonly popup: PopupControl;
  readonly isBusy: boolean;
  readonly onDelete: () => void;
}): ReactElement {
  const { popup } = props;
  const menuId = useId();
  useOnlyCommentMenuOpen(popup);
  return (
    <div className={styles.messageMenu}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.action}
        aria-label="Message actions"
        title="Message actions"
        aria-haspopup="menu"
        aria-expanded={popup.isOpen}
        aria-controls={popup.isOpen ? menuId : undefined}
        data-message-actions=""
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
          aria-label="Message actions"
          className={styles.menu}
          onKeyDown={popup.onPopupKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            data-popup-item=""
            aria-label="Delete message"
            disabled={props.isBusy}
            onClick={() => {
              popup.toggle();
              props.onDelete();
            }}
          >
            <span className={styles.menuLabel}>Delete message</span>
          </button>
        </div>
      )}
    </div>
  );
}
