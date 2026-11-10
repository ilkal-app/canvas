import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { Button } from '../controls/button.js';
import type { PopupControl } from '../focus/use-popup.js';
import { Icon } from '../icons/icon.js';

import type { Thread } from './comment-api.js';
import { isDeletableBy } from './comment-authors.js';
import type { CommentData } from './comment-data-context.js';
import { useOnlyCommentMenuOpen } from './comment-message-menu.js';
import styles from './comments.module.css';

/**
 * The card's actions (Figma `Comment/Actions`): Resolve, or Reopen on a resolved thread, and ⋯
 * ({@link MoreMenu}) when the signed-in person may delete the thread (each message has its own ⋯,
 * `MessageMenu`), whose
 * deletion it asks to confirm.
 *
 * @param props - The thread, its actions and the menu's popup.
 * @param props.data - Thread data.
 * @param props.thread - The open thread.
 * @param props.popup - The ⋯ menu's popup.
 * @param props.isInBar - Whether they sit in the floating whiteboard card's bar, always
 *   shown, rather than over the card's top edge on hover.
 * @param props.onReopen - Reopens.
 * @returns The actions.
 */
export function CardActions(props: {
  readonly data: CommentData;
  readonly thread: Thread;
  readonly popup: PopupControl;
  readonly isInBar?: boolean | undefined;
  readonly onReopen: () => void;
}): ReactElement {
  const { data, thread, popup } = props;
  const [isDeletingThread, setDeletingThread] = useState(false);
  const canDeleteThread = mayDeleteThread(data, thread);
  const resolve = (): void => {
    // Resolving collapses the card and closes it (the approved design); a failed resolve keeps
    // it open, with its error, to try again.
    data.change(`/${thread.id}/resolve`).then(
      () => {
        data.close();
      },
      () => undefined,
    );
  };
  const deletion = isDeletingThread && (
    <ThreadDeletion
      isBusy={data.isBusy}
      onConfirm={() => {
        setDeletingThread(false);
        void data.deleteThread(thread).catch(() => undefined);
      }}
      onCancel={() => {
        setDeletingThread(false);
        popup.triggerRef.current?.focus();
      }}
    />
  );
  const isInBar = props.isInBar === true;
  const actions = (
    <div className={isInBar ? styles.barActions : styles.actions}>
      <button
        type="button"
        className={styles.action}
        aria-label={thread.isResolved ? 'Reopen' : 'Resolve'}
        data-resolved={thread.isResolved}
        title={thread.isResolved ? 'Reopen' : 'Resolve'}
        disabled={data.isBusy}
        onClick={thread.isResolved ? props.onReopen : resolve}
      >
        <Icon name="check" />
      </button>
      {canDeleteThread && (
        <MoreMenu
          isBusy={data.isBusy}
          popup={popup}
          onDeleteThread={() => {
            // A comment just placed, theirs alone, goes at once (no undo brings a
            // placement back, so its deletion is the one action); any other thread asks.
            if (isOwnSoleComment(data, thread))
              void data.deleteThread(thread).catch(() => undefined);
            else setDeletingThread(true);
          }}
        />
      )}
      {!isInBar && deletion}
    </div>
  );
  // In the floating whiteboard card's bar the question takes its own row under the bar's
  // controls, not the 28 px row; over the classic card's edge it stays in the actions.
  return isInBar ? (
    <>
      {actions}
      {deletion}
    </>
  ) : (
    actions
  );
}

/**
 * Whether a thread is the signed-in person's comment alone: they started it and its one
 * message is theirs, so deleting it loses nobody else's words and needs no question.
 *
 * @param data - The person.
 * @param thread - The thread.
 * @returns True for a thread they started whose only message is theirs.
 */
function isOwnSoleComment(data: Pick<CommentData, 'user'>, thread: Thread): boolean {
  const [only, ...others] = thread.messages;
  return (
    thread.starterId === data.user.id && others.length === 0 && only?.authorId === data.user.id
  );
}

/**
 * Whether the signed-in person may delete a thread, as the boards service allows: an
 * owner or editor any thread, anyone else who may comment a thread they started (the starter the
 * service records; for a list without it, the author of its first message or their agent's).
 *
 * @param data - The person and whether they may edit the board.
 * @param thread - The thread.
 * @returns True when "Delete thread" is offered.
 */
export function mayDeleteThread(
  data: Pick<CommentData, 'user' | 'canEditBoard'>,
  thread: Thread,
): boolean {
  if (data.canEditBoard) return true;
  if (thread.starterId !== undefined) return thread.starterId === data.user.id;
  const first = thread.messages[0];
  return first !== undefined && isDeletableBy(first, data.user.id);
}

/**
 * The card's ⋯ (Figma `Comment/Actions`): a menu holding "Delete thread" alone (item 16;
 * each message has its own ⋯, `MessageMenu`), offered when the person may delete the thread.
 *
 * @param props - The popup and what the choice does.
 * @param props.isBusy - Whether a request is running.
 * @param props.popup - The menu's popup.
 * @param props.onDeleteThread - Asks to delete the thread.
 * @returns The button and, open, the menu.
 */
function MoreMenu(props: {
  readonly isBusy: boolean;
  readonly popup: PopupControl;
  readonly onDeleteThread: () => void;
}): ReactElement {
  const { popup } = props;
  const menuId = useId();
  useOnlyCommentMenuOpen(popup);
  return (
    <div className={styles.menuAnchor}>
      <button
        ref={popup.triggerRef}
        type="button"
        className={styles.action}
        aria-label="More"
        title="More"
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
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuItem}
            data-popup-item=""
            aria-label="Delete thread"
            disabled={props.isBusy}
            onClick={() => {
              popup.close();
              props.onDeleteThread();
            }}
          >
            <span className={styles.menuLabel}>Delete thread</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The question a thread's deletion asks when chosen from ⋯, with Confirm and Cancel
 * named as the message deletion's are ("Confirm: Delete thread"), focus on Confirm.
 *
 * @param props - What the buttons do.
 * @param props.isBusy - Whether a request is running.
 * @param props.onConfirm - Deletes the thread.
 * @param props.onCancel - Keeps it.
 * @returns The group.
 */
function ThreadDeletion(props: {
  readonly isBusy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    confirm.current?.focus();
  }, []);
  return (
    <span
      role="group"
      aria-label="Delete this thread?"
      className={styles.confirm}
      data-thread-deletion=""
    >
      <span>Delete this thread?</span>
      <Button
        kind="danger"
        buttonRef={confirm}
        name="Confirm: Delete thread"
        isDisabled={props.isBusy}
        onClick={props.onConfirm}
      >
        Delete
      </Button>
      <Button name="Cancel: Delete thread" onClick={props.onCancel}>
        Cancel
      </Button>
    </span>
  );
}
