import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { Button } from '../controls/button.js';
import { usePopup } from '../focus/use-popup.js';
import { measureReservedZones } from '../selection-popover/reserved-zones.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import type { Message, ThreadPin } from './comment-api.js';
import { CommentAuthor } from './comment-author.js';
import { authorKeyOf, isDeletableBy } from './comment-authors.js';
import { CommentAvatar } from './comment-avatar.js';
import { CardActions } from './comment-card-actions.js';
import { CardBar, handBackKeyboard } from './comment-card-bar.js';
import {
  cardPlacement,
  pinRect,
  WHITEBOARD_CARD_SPACING,
  type ScreenInsets,
  type ScreenSize,
} from './comment-card-position.js';
import { CommentComposer } from './comment-composer.js';
import type { CommentData } from './comment-data-context.js';
import { MessageMenu } from './comment-message-menu.js';
import { pinOfPlacement } from './comment-placement.js';
import { shortTime } from './comment-time.js';
import styles from './comments.module.css';

/**
 * How far the card keeps from the canvas's top and sides, CSS px: below the top bars (16 px in,
 * 42 px tall), 12 px from either side. Its room above the dock is its stylesheet's
 * `max-height` (from `dockTop` of dock.module.css), read where it is placed.
 */
export const CARD_INSETS: Omit<ScreenInsets, 'bottom'> = { top: 16 * 2 + 42, right: 12, left: 12 };

/** Props of {@link CommentDialog}. */
export interface CommentDialogProps {
  /** Thread data and actions. */
  readonly data: CommentData;
  /** Whether an editor composer and the actions are shown. */
  readonly canWrite: boolean;
  /** The pin's point on the canvas, CSS px; none before the camera is known. */
  readonly anchor?: { readonly x: number; readonly y: number } | undefined;
  /** The canvas's size, CSS px. */
  readonly viewport?: ScreenSize | undefined;
  /**
   * How it moves: `open` grows from its pin, `switch` cross-fades in place of another
   * card, `closing` shrinks back into its pin and takes no input.
   */
  readonly motion?: 'open' | 'switch' | 'closing' | undefined;
  /**
   * Whether it is the floating whiteboard's card (design frame B): a bar with its title,
   * its actions and Close, 16 px padding, 12 px off its pin and 8 px higher.
   */
  readonly isWhiteboard?: boolean | undefined;
}

/**
 * What a first message adds for its new thread: its pin's id and its pin, which the service keeps;
 * nothing for a reply.
 *
 * @param data - Thread data, with the pending placement if any.
 * @returns The new thread's fields.
 */
function newThreadFields(data: CommentData): { pinId?: string; pin?: ThreadPin } {
  const { placement } = data;
  if (placement === undefined) return {};
  return { pinId: placement.id, pin: pinOfPlacement(data.connection.store.read(), placement) };
}

/**
 * A thread's card (Figma "Comment box — proposal"): a non-modal dialog beside its pin,
 * which follows the pin as the camera moves and flips to the pin's left near the right edge
 * (`cardPlacement`), clear of the floating chrome. Under the floating whiteboard chrome
 * a bar heads it (`CardBar`: its title, actions and Close; design frame B); otherwise no header: the messages, a reply field, and Resolve and ⋯ (Delete thread; each message has its own ⋯ with Delete message)
 * that show while the pointer is over the card or focus is in them. Escape or a press outside
 * closes it; opening it never locks peers or changes the document.
 *
 * @param props - Data, write permission, and where its pin is.
 * @returns The open thread.
 */
export function CommentDialog(props: CommentDialogProps): ReactElement {
  const { data, canWrite, anchor, viewport } = props;
  const run = (suffix: string, method?: 'DELETE'): Promise<void> =>
    data.change(suffix, undefined, method).catch(() => undefined);
  const thread = data.threads.find((entry) => entry.id === data.selectedId);
  const root = useRef<HTMLElement>(null);
  const [deletingId, setDeletingId] = useState<string>();
  const popup = usePopup();
  useEffect(() => {
    root.current?.focus();
  }, [data.selectedId, data.placement]);
  const isWhiteboard = props.isWhiteboard === true;
  usePlacement(root, anchor, viewport, isWhiteboard);
  const actions = thread && canWrite && (
    <CardActions
      data={data}
      thread={thread}
      popup={popup}
      isInBar={isWhiteboard}
      onReopen={() => void run(`/${thread.id}/reopen`)}
    />
  );
  return (
    <section
      ref={root}
      role="dialog"
      aria-label="Comment thread"
      tabIndex={-1}
      className={styles.card}
      data-motion={props.motion ?? 'open'}
      inert={props.motion === 'closing'}
      data-comment-card=""
      data-chrome={isWhiteboard ? 'whiteboard' : undefined}
      onKeyDown={(event) => {
        closeOnEscape(event, data);
      }}
    >
      {isWhiteboard ? <CardBar data={data} thread={thread} actions={actions} /> : actions}
      {thread && thread.messages.length > 0 && (
        <ThreadMessages
          messages={thread.messages}
          userId={canWrite ? data.user.id : undefined}
          deletingId={deletingId}
          isBusy={data.isBusy}
          onAsk={setDeletingId}
          onConfirm={(messageId) => {
            setDeletingId(undefined);
            root.current?.focus();
            void run(`/${thread.id}/messages/${messageId}`, 'DELETE');
          }}
          onCancel={() => {
            setDeletingId(undefined);
          }}
        />
      )}
      {canWrite && (
        <CommentComposer
          key={thread?.id ?? data.placement?.id}
          members={data.members}
          isBusy={data.isBusy}
          placeholder={thread ? (isWhiteboard ? 'Reply' : 'Reply…') : 'Add a comment…'}
          onPost={(text, mentions) =>
            data.change(thread ? `/${thread.id}/messages` : '', {
              text,
              mentions,
              ...newThreadFields(data),
            })
          }
        />
      )}
      {data.error && (
        <p role="alert" className={styles.error}>
          {data.error}
        </p>
      )}
    </section>
  );
}

/**
 * Closes the card on Escape, unless an open ⋯ menu took it (`usePopup` prevents its default),
 * and gives the keyboard back to the canvas.
 *
 * @param event - The key.
 * @param data - The comments, whose `close` closes the card.
 */
function closeOnEscape(event: KeyboardEvent, data: CommentData): void {
  if (event.key !== 'Escape' || event.defaultPrevented || isImeKey(event.nativeEvent)) return;
  event.stopPropagation();
  data.close();
  handBackKeyboard(event.currentTarget.ownerDocument);
}

/**
 * Places the card beside its pin after each render, from the card's own measured size, so it
 * follows the pin as the camera moves and as messages come and go.
 *
 * @param root - The card.
 * @param anchor - The pin's point.
 * @param viewport - The canvas's size.
 * @param isWhiteboard - Whether it is the floating whiteboard's card, spaced as frame B.
 */
function usePlacement(
  root: RefObject<HTMLElement | null>,
  anchor: CommentDialogProps['anchor'],
  viewport: CommentDialogProps['viewport'],
  isWhiteboard: boolean,
): void {
  useLayoutEffect(() => {
    const card = root.current;
    if (!card || !anchor || !viewport) return;
    // The stylesheet's maximum height ends a step above the dock: the room below it is the inset.
    const room = Number.parseFloat(getComputedStyle(card).maxHeight);
    const bottom = Number.isFinite(room) ? viewport.height - CARD_INSETS.top - room : 0;
    // The floating chrome it keeps clear of, in the canvas's pixels: the card is placed
    // in the same box as the canvas.
    const frame = card.offsetParent?.getBoundingClientRect();
    const zones =
      frame === undefined
        ? []
        : measureReservedZones(frame).map((zone) => ({
            left: zone.x,
            top: zone.y,
            width: zone.width,
            height: zone.height,
          }));
    const placement = cardPlacement({
      pin: pinRect(anchor),
      card: { width: card.offsetWidth, height: card.offsetHeight },
      viewport,
      insets: { ...CARD_INSETS, bottom },
      zones,
      ...(isWhiteboard ? { spacing: WHITEBOARD_CARD_SPACING } : {}),
    });
    card.style.left = `${String(placement.left)}px`;
    card.style.top = `${String(placement.top)}px`;
    card.dataset.side = placement.side;
  });
}

/**
 * The thread's messages, one asking about its deletion when chosen from its own ⋯.
 *
 * @param props - The messages and the deletion step.
 * @param props.messages - The thread's messages, in order.
 * @param props.userId - The signed-in person, who may delete their own messages and their
 *   agents'; undefined when they may not write.
 * @param props.deletingId - The message whose deletion is asked, if any.
 * @param props.isBusy - Whether a request is running.
 * @param props.onAsk - Asks to delete a message, by id.
 * @param props.onConfirm - Deletes a message, by id.
 * @param props.onCancel - Keeps it.
 * @returns The list.
 */
function ThreadMessages(props: {
  readonly messages: readonly Message[];
  readonly userId: string | undefined;
  readonly deletingId: string | undefined;
  readonly isBusy: boolean;
  readonly onAsk: (messageId: string) => void;
  readonly onConfirm: (messageId: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { userId } = props;
  return (
    <ul aria-label="Messages" className={styles.messages}>
      {props.messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          canDelete={userId !== undefined && isDeletableBy(message, userId)}
          isAsking={props.deletingId === message.id}
          isBusy={props.isBusy}
          onAsk={() => {
            props.onAsk(message.id);
          }}
          onConfirm={() => {
            props.onConfirm(message.id);
          }}
          onCancel={props.onCancel}
        />
      ))}
    </ul>
  );
}

/**
 * One message (Figma `Comment/Message`): avatar, name, short time (the full date on hover),
 * text; its own ⋯ when the person may delete it (`MessageMenu`, item 16); while its
 * deletion is asked, the question with Confirm and Cancel, named as `ConfirmButton` names them
 * ("Confirm: Delete message"), focus on Confirm, and Cancel back on its ⋯.
 *
 * @param props - The message and its deletion step.
 * @param props.message - The message.
 * @param props.canDelete - Whether the person may delete it.
 * @param props.isAsking - Whether its deletion is being asked.
 * @param props.isBusy - Whether a request is running.
 * @param props.onAsk - Asks to delete it.
 * @param props.onConfirm - Deletes it.
 * @param props.onCancel - Keeps it.
 * @returns The list item.
 */
function MessageItem(props: {
  readonly message: Message;
  readonly canDelete: boolean;
  readonly isAsking: boolean;
  readonly isBusy: boolean;
  readonly onAsk: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { message, isAsking } = props;
  const confirm = useRef<HTMLButtonElement>(null);
  const menu = usePopup();
  useLayoutEffect(() => {
    if (isAsking) confirm.current?.focus();
  }, [isAsking]);
  return (
    <li className={styles.message} data-can-delete={props.canDelete ? '' : undefined}>
      <CommentAvatar
        userId={authorKeyOf(message)}
        name={message.authorName}
        kind={message.authorKind ?? 'user'}
      />
      <div className={styles.body}>
        <p className={styles.meta}>
          <CommentAuthor message={message} />
          <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
            {shortTime(message.createdAt, Date.now())}
          </time>
        </p>
        <p className={styles.text}>{message.text}</p>
        {isAsking && (
          <span role="group" aria-label="Delete this message?" className={styles.confirm}>
            <span>Delete this message?</span>
            <Button
              kind="danger"
              buttonRef={confirm}
              name="Confirm: Delete message"
              isDisabled={props.isBusy}
              onClick={props.onConfirm}
            >
              Delete
            </Button>
            <Button
              name="Cancel: Delete message"
              onClick={() => {
                props.onCancel();
                menu.triggerRef.current?.focus();
              }}
            >
              Cancel
            </Button>
          </span>
        )}
      </div>
      {props.canDelete && <MessageMenu popup={menu} isBusy={props.isBusy} onDelete={props.onAsk} />}
    </li>
  );
}
