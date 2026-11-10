import type { ReactElement, ReactNode } from 'react';

import { Icon } from '../icons/icon.js';

import type { Thread } from './comment-api.js';
import type { CommentData } from './comment-data-context.js';
import styles from './comments.module.css';

/**
 * The card's title under the floating whiteboard chrome (design frame B, "Thread · 2
 * replies"): the thread's messages counted as its replies, as its pin counts them; "New comment"
 * while the first message is written.
 *
 * @param thread - The open thread, or none for a new comment.
 * @returns The title.
 */
export function cardTitleOf(thread: Thread | undefined): string {
  if (thread === undefined) return 'New comment';
  const count = thread.messages.length;
  return `Thread · ${String(count)} ${count === 1 ? 'reply' : 'replies'}`;
}

/**
 * Gives the keyboard back to the canvas: its shortcuts listen on the window while
 * nothing of the page's own has focus, as the inspector drawer's `focusCanvas` hands it back.
 *
 * @param document - The page's document.
 */
export function handBackKeyboard(document: Document): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * The card's bar under the floating whiteboard chrome (design frame B): its title, then
 * the thread's actions (Resolve or Reopen, and ⋯, for a person who writes) and Close, which
 * closes the card and gives the keyboard back to the canvas, as Escape does.
 *
 * @param props - The comments, the thread and its actions.
 * @param props.data - The comments, whose `close` closes the card.
 * @param props.thread - The open thread, or none for a new comment.
 * @param props.actions - Resolve and ⋯, laid out in the bar; none for a viewer.
 * @returns The bar.
 */
export function CardBar(props: {
  readonly data: CommentData;
  readonly thread: Thread | undefined;
  readonly actions: ReactNode;
}): ReactElement {
  return (
    <div className={styles.bar} data-comment-card-bar="">
      <span className={styles.barTitle}>{cardTitleOf(props.thread)}</span>
      {props.actions}
      <button
        type="button"
        className={styles.action}
        aria-label="Close"
        title="Close"
        onClick={(event) => {
          props.data.close();
          handBackKeyboard(event.currentTarget.ownerDocument);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
