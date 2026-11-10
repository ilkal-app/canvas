import { useId, type ReactElement } from 'react';

import type { Thread } from './comment-api.js';
import { authorKeyOf } from './comment-authors.js';
import { CommentAvatar } from './comment-avatar.js';
import { clusterPins, worldBoundsOf, type PointBounds } from './comment-clusters.js';
import type { CommentData } from './comment-data-context.js';
import { usePinDrag } from './comment-pin-drag.js';
import styles from './comments.module.css';

/** Moves a thread's pin to a canvas point; settles once saved or refused. */
export type PinDrop = (
  thread: Thread,
  point: { readonly x: number; readonly y: number },
) => Promise<void>;

/** The key of a pending placement's pin among the positions. */
export const PLACEMENT_KEY = '';

/** Pin points on the canvas and the canvas's size, as one comparable snapshot. */
export interface PinLayout {
  /**
   * Each thread's pin point, CSS px, by thread id, and whether it is hidden while its object
   * moves; a pending placement's under `''`.
   */
  readonly pins: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly isMoving: boolean;
  }[];
  /** The canvas's width, CSS px. */
  readonly width: number;
  /** The canvas's height, CSS px. */
  readonly height: number;
}

/**
 * A thread's pin (Figma `Comment/Pin`): its first author's avatar (or, under the floating
 * whiteboard chrome, a 28 px accent disc with its message count), anchored at its bottom-left
 * corner on its point; open, resolved or at rest; faded out while its object moves;
 * on hover or focus it lifts and, after a pause, previews the first message.
 *
 * @param props - The pin's place, its thread, whether it is open and what a press does.
 * @param props.pin - Its point and whether its object moves.
 * @param props.thread - Its thread.
 * @param props.isOpen - Whether its thread is open.
 * @param props.isCounted - Whether it shows its thread's message count instead of the first
 *   author's avatar (the floating whiteboard's pin; design frame B), the count also its
 *   description ("2 messages").
 * @param props.onSelect - Opens a thread, by id.
 * @param props.onDrop - Moves the pin to a canvas point, when the person may move it:
 *   it is then dragged (`usePinDrag`); absent, it is only pressed.
 * @returns The button.
 */
function ThreadPin(props: {
  readonly pin: PinLayout['pins'][number];
  readonly thread: Thread;
  readonly isOpen: boolean;
  readonly isCounted: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDrop?:
    ((point: { readonly x: number; readonly y: number }) => Promise<void>) | undefined;
}): ReactElement {
  const { pin, thread, isOpen, onDrop } = props;
  const first = thread.messages[0];
  const countId = useId();
  const count = thread.messages.length;
  const drag = usePinDrag(pin, onDrop !== undefined, onDrop ?? (() => Promise.resolve()));
  const at = drag.at ?? pin;
  return (
    <button
      type="button"
      className={styles.pin}
      data-comment-pin=""
      data-variant={props.isCounted ? 'count' : undefined}
      data-resolved={thread.isResolved}
      data-moving={pin.isMoving}
      data-state={isOpen ? 'open' : thread.isResolved ? 'resolved' : 'rest'}
      aria-label={`Comment thread: ${first?.text ?? 'Empty thread'}`}
      aria-describedby={props.isCounted ? countId : undefined}
      aria-expanded={isOpen}
      title={onDrop === undefined ? undefined : 'Comment · Drag to move'}
      data-draggable={onDrop === undefined ? undefined : ''}
      data-dragging={drag.at === undefined ? undefined : 'true'}
      style={{ left: at.x, top: at.y }}
      onPointerDown={drag.onPointerDown}
      onClick={() => {
        if (!drag.takeDragged()) props.onSelect(pin.id);
      }}
    >
      {props.isCounted ? (
        <>
          <span className={styles.pinCount} aria-hidden="true">
            {count}
          </span>
          <span id={countId} hidden>
            {`${String(count)} ${count === 1 ? 'message' : 'messages'}`}
          </span>
        </>
      ) : first ? (
        <CommentAvatar
          userId={authorKeyOf(first)}
          name={first.authorName}
          kind={first.authorKind ?? 'user'}
        />
      ) : (
        <span className={styles.avatar} aria-hidden="true" />
      )}
      {first && (
        <span className={styles.preview} aria-hidden="true">
          <strong>{first.authorName}</strong>
          <span className={styles.previewText}>{first.text}</span>
        </span>
      )}
    </button>
  );
}

/**
 * A cluster of pins that overlap on screen (Figma `Comment/Cluster`): the faces of its
 * first two threads' authors and the count, at its first pin's place. A press zooms to fit its
 * threads.
 *
 * @param props - Its place, its threads and what a press does.
 * @param props.x - Across, CSS px on the canvas.
 * @param props.y - Down.
 * @param props.threads - Its threads, in order.
 * @param props.onPress - Zooms to them.
 * @returns The button.
 */
function ClusterPin(props: {
  readonly x: number;
  readonly y: number;
  readonly threads: readonly Thread[];
  readonly onPress: () => void;
}): ReactElement {
  const authors = [
    ...new Map(
      props.threads.flatMap((thread) => {
        const first = thread.messages[0];
        return first ? [[authorKeyOf(first), first] as const] : [];
      }),
    ),
  ].slice(0, 2);
  const count = props.threads.length;
  return (
    <button
      type="button"
      className={styles.cluster}
      data-comment-pin=""
      aria-label={`${String(count)} comment threads: zoom to them`}
      style={{ left: props.x, top: props.y }}
      onClick={props.onPress}
    >
      <span className={styles.faces}>
        {authors.map(([key, first]) => (
          <CommentAvatar
            key={key}
            userId={key}
            name={first.authorName}
            kind={first.authorKind ?? 'user'}
          />
        ))}
      </span>
      <span className={styles.count}>{count}</span>
    </button>
  );
}

/**
 * The pins over the canvas: pins that overlap on screen drawn as one cluster
 * (`clusterPins`), the others alone. The open thread's pin, a moving pin and a new comment's pin
 * are never clustered, so the card stays beside its pin and a moving pin can fade out alone.
 *
 * @param props - The pins' places, the comments and what a cluster's press does.
 * @param props.pins - Every pin's point and whether it moves.
 * @param props.data - The comments.
 * @param props.threadsById - The threads, by id.
 * @param props.onFrame - Frames a world rectangle.
 * @param props.toWorld - Turns a canvas point into a board point, with the camera now.
 * @param props.isCounted - Whether pins show their message counts (the floating whiteboard's
 *   pin); avatars if absent.
 * @param props.onDrop - Moves a thread's pin to a canvas point: the pins the person
 *   may move are dragged; none when absent.
 * @returns The pins and clusters.
 */
export function PinLayer(props: {
  readonly pins: PinLayout['pins'];
  readonly data: CommentData;
  readonly threadsById: ReadonlyMap<string, Thread>;
  readonly onFrame: (bounds: PointBounds) => void;
  readonly toWorld: (point: { readonly x: number; readonly y: number }) => {
    readonly x: number;
    readonly y: number;
  };
  readonly isCounted?: boolean | undefined;
  readonly onDrop?: PinDrop | undefined;
}): ReactElement {
  const { pins, data, threadsById } = props;
  const isCounted = props.isCounted === true;
  const isAlone = (pin: PinLayout['pins'][number]): boolean =>
    pin.id === PLACEMENT_KEY || pin.isMoving || pin.id === data.selectedId;
  const pinsById = new Map(pins.map((pin) => [pin.id, pin]));
  const groups = clusterPins(pins.filter((pin) => !isAlone(pin) && threadsById.has(pin.id)));
  const alone = pins.filter(isAlone);
  return (
    <>
      {alone.map((pin) =>
        pin.id === PLACEMENT_KEY ? (
          <span
            key={PLACEMENT_KEY}
            className={styles.pin}
            data-state="open"
            data-variant={isCounted ? 'count' : undefined}
            aria-hidden="true"
            style={{ left: pin.x, top: pin.y }}
          >
            {isCounted ? null : <CommentAvatar userId={data.user.id} name={data.user.name} />}
          </span>
        ) : (
          <PinOf
            key={pin.id}
            pin={pin}
            data={data}
            threadsById={threadsById}
            isCounted={isCounted}
            onDrop={props.onDrop}
          />
        ),
      )}
      {groups.map((group) => {
        const [only] = group.ids;
        const first = only === undefined ? undefined : pinsById.get(only);
        if (group.ids.length === 1 && first) {
          return (
            <PinOf
              key={first.id}
              pin={first}
              data={data}
              threadsById={threadsById}
              isCounted={isCounted}
              onDrop={props.onDrop}
            />
          );
        }
        return (
          <ClusterPin
            key={group.ids.join(' ')}
            x={group.x}
            y={group.y}
            threads={group.ids.flatMap((id) => threadsById.get(id) ?? [])}
            onPress={() => {
              const points = group.ids.flatMap((id) => {
                const pin = pinsById.get(id);
                return pin ? [props.toWorld(pin)] : [];
              });
              props.onFrame(worldBoundsOf(points));
            }}
          />
        );
      })}
    </>
  );
}

/**
 * One thread's pin, if its thread is known.
 *
 * @param props - The pin, the comments and the threads.
 * @param props.pin - Its point and whether it moves.
 * @param props.data - The comments.
 * @param props.threadsById - The threads, by id.
 * @param props.isCounted - Whether it shows its message count.
 * @param props.onDrop - Moves a pin, for the pins the person may move.
 * @returns The pin, or nothing.
 */
function PinOf(props: {
  readonly pin: PinLayout['pins'][number];
  readonly data: CommentData;
  readonly threadsById: ReadonlyMap<string, Thread>;
  readonly isCounted: boolean;
  readonly onDrop: PinDrop | undefined;
}): ReactElement | null {
  const { data, onDrop } = props;
  const thread = props.threadsById.get(props.pin.id);
  // A pin the service keeps moves for the person who started its thread or edits the board.
  const canMove = thread?.pin != null && (thread.starterId === data.user.id || data.canEditBoard);
  return thread ? (
    <ThreadPin
      pin={props.pin}
      thread={thread}
      isOpen={props.pin.id === data.selectedId}
      isCounted={props.isCounted}
      onSelect={(id) => {
        data.select(id);
      }}
      onDrop={canMove && onDrop ? (point) => onDrop(thread, point) : undefined}
    />
  ) : null;
}
