import { useContext, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

import { screenToWorld, worldToScreen } from '@canvas/engine';
import { firstPageIdOf, type Board, type BoardObject } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { placeKeyOf } from '../engine/object-place.js';
import { useShellDrawers } from '../shell/shell-board-mode.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { useCardMotion } from './comment-card-motion.js';
import { useCommentMode } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { useThreadLinkPage } from './comment-deep-link.js';
import { CommentDialog } from './comment-dialog.js';
import { pinPageOf, usePageSwitchClosesCard } from './comment-page-switch.js';
import { PinLayer, PLACEMENT_KEY, type PinDrop, type PinLayout } from './comment-pins.js';
import { commentPlacement } from './comment-placement.js';
import styles from './comments.module.css';
import { PinMotion } from './pin-motion.js';
import { threadPinPlaceOf } from './thread-pin-place.js';

/**
 * Whether the person's gesture moves an object or a group or frame holding it.
 *
 * @param board - The document.
 * @param target - The object.
 * @param engine - The engine, which knows the gesture.
 * @returns True while one of them moves.
 */
function isGestureMoving(board: Board, target: BoardObject, engine: MountedEngine): boolean {
  const view = engine.board;
  if (!view.isMoving) return false;
  for (let object: BoardObject | undefined = target; object;) {
    if (view.isMoving(object.id)) return true;
    object = object.parentId ? board.objects.get(object.parentId) : undefined;
  }
  return false;
}

/**
 * A key of a pin's place: its board point and the places of its object and every group
 * or frame holding it, so a collaborator's move, resize or rotation of any of them changes it.
 *
 * @param board - The document.
 * @param point - The pin's board point.
 * @param point.x - Across.
 * @param point.y - Down.
 * @param target - Its object, for an anchored pin.
 * @returns The key.
 */
function placeOf(
  board: Board,
  point: { readonly x: number; readonly y: number },
  target: BoardObject | undefined,
): string {
  let key = `${String(point.x)},${String(point.y)}`;
  for (let object = target; object;) {
    key += placeKeyOf(object);
    object = object.parentId ? board.objects.get(object.parentId) : undefined;
  }
  return key;
}

/**
 * Current pin positions on the page shown, transformed from their target's frame to canvas CSS pixels, each with
 * whether it hides while its object moves (`PinMotion`), the pending placement's point and the
 * canvas's size.
 *
 * @param data - Threads and their document.
 * @param engine - Live camera and the person's gesture.
 * @param motion - Which pins' objects are moving.
 * @param now - The time, ms.
 * @returns A compact JSON snapshot so React renders only when positions change.
 */
function positions(
  data: CommentData,
  engine: MountedEngine,
  motion: PinMotion,
  now: number,
): string {
  const board = data.connection.store.read();
  const camera = engine.camera();
  // Only the page shown has its pins drawn; every page's where the engine has none.
  const page = engine.pages?.current();
  const pins: PinLayout['pins'][number][] = data.threads.flatMap((thread) => {
    // The service's pin, else the document's until it is adopted.
    const place = threadPinPlaceOf(board, thread);
    if (place === undefined || (page !== undefined && place.pageId !== page)) return [];
    const { point, target } = place;
    const isMoving = motion.isHidden(
      thread.id,
      placeOf(board, point, target),
      now,
      target !== undefined && isGestureMoving(board, target, engine),
    );
    const screen = worldToScreen(camera, point);
    return [{ id: thread.id, x: screen.x, y: screen.y, isMoving }];
  });
  motion.keepOnly(new Set(pins.map((pin) => pin.id)));
  if (data.placement && (page === undefined || (data.placement.pageId ?? page) === page)) {
    const screen = worldToScreen(camera, data.placement.point);
    pins.push({ id: PLACEMENT_KEY, x: screen.x, y: screen.y, isMoving: false });
  }
  const layout: PinLayout = {
    pins,
    width: camera.viewportWidthPx,
    height: camera.viewportHeightPx,
  };
  return JSON.stringify(layout);
}

/**
 * Where a dragged pin goes: its drop on the canvas as a board point, on the object under
 * it there (hit as a new comment's placement is, `commentPlacement`) or at that point, on the
 * page shown; saved through the comments (`movePin`).
 *
 * @param data - The comments.
 * @param engine - The camera and the page shown.
 * @param themeName - The theme shown, which colour tokens are hit in.
 * @returns What a pin's drop does.
 */
function pinDropOf(data: CommentData, engine: MountedEngine, themeName: ThemeName): PinDrop {
  return async (thread, point) => {
    const camera = engine.camera();
    const world = screenToWorld(camera, point);
    const pageId = engine.pages?.current();
    const board = data.connection.store.read();
    const { anchor } = commentPlacement(board, world, camera.zoom, themeName, pageId);
    const page = pageId ?? thread.pin?.pageId ?? firstPageIdOf(board);
    await data.movePin?.(thread, { pageId: page, anchor, point: world }).catch(() => undefined);
  };
}

/**
 * Accessible DOM pins over the canvas, the open thread's card beside its pin, and the
 * threads panel. Captures only primary placement clicks. A new selection closes the card, and
 * under the floating whiteboard chrome resolved pins hide unless shown.
 *
 * @param props - Mounted engine for camera coordinates.
 * @param props.engine - Engine, once ready.
 * @param props.themeName - The theme shown, which a click picks colour tokens in; light if absent.
 * @returns Site comments or nothing for a standalone canvas.
 */
export function CommentOverlay({
  engine,
  themeName = 'light',
}: {
  readonly engine: MountedEngine | undefined;
  readonly themeName?: ThemeName;
}): ReactElement | null {
  const data = useContext(commentDataContext);
  const mode = useCommentMode();
  const { marker, encoded } = usePinOverlay(data, engine, mode?.isPlacing ?? false, themeName);
  const hasCard =
    data !== undefined && (data.selectedId !== undefined || data.placement !== undefined);
  useCloseOnOutsidePress(hasCard, marker, data);
  useSelectionClosesThread(hasCard, engine, data);
  usePageSwitchClosesCard(engine, data);
  useThreadLinkPage(engine, data);
  // Under the floating whiteboard chrome there is no threads panel: resolved pins hide unless the
  // board menu shows them.
  const isFloating = !useShellDrawers().hasInspector;
  const motion = useCardMotion(data);
  if (!data || !mode) return null;
  const threadsById = new Map(data.threads.map((thread) => [thread.id, thread]));
  const layout = JSON.parse(encoded) as PinLayout;
  const pins =
    isFloating && mode.isResolvedShown !== true
      ? layout.pins.filter(
          (pin) => pin.id === data.selectedId || threadsById.get(pin.id)?.isResolved !== true,
        )
      : layout.pins;
  const card = motion.content;
  const cardKey = card?.placement ? PLACEMENT_KEY : card?.selectedId;
  const anchor = layout.pins.find((pin) => pin.id === cardKey);
  return (
    <>
      <span ref={marker} hidden />
      <PinLayer
        pins={pins}
        data={data}
        threadsById={threadsById}
        onFrame={(bounds) => {
          engine?.runCanvasAction({ type: 'frame', bounds });
        }}
        toWorld={(point) => (engine ? screenToWorld(engine.camera(), point) : point)}
        isCounted={isFloating}
        onDrop={engine ? pinDropOf(data, engine, themeName) : undefined}
      />
      {mode.isPanelOpen && <ThreadsPanel data={data} engine={engine} />}
      {card && (
        <CommentDialog
          key={motion.key}
          data={motion.isClosing ? { ...data, ...card } : data}
          canWrite={mode.canWrite}
          motion={motion.isClosing ? 'closing' : motion.isSwitch ? 'switch' : 'open'}
          anchor={anchor}
          viewport={layout.width > 0 ? { width: layout.width, height: layout.height } : undefined}
          isWhiteboard={isFloating}
        />
      )}
    </>
  );
}

/**
 * The threads panel in the right-hand drawer slot, kept for browsing: open and
 * resolved threads of every page, a thread that mentions the viewer marked, and the retry after a
 * failed load. A thread whose pin is on another page shows that page first, so its card opens
 * beside its pin.
 *
 * @param props - Thread data and the engine.
 * @param props.data - Threads and actions.
 * @param props.engine - The engine, whose pages show a thread's page; absent before it mounts.
 * @returns The panel.
 */
function ThreadsPanel({
  data,
  engine,
}: {
  readonly data: CommentData;
  readonly engine: MountedEngine | undefined;
}): ReactElement {
  return (
    <aside aria-label="Comments" className={styles.panel}>
      <h2>Comments</h2>
      {[false, true].map((isResolved) => (
        <section key={String(isResolved)}>
          <h3>{isResolved ? 'Resolved' : 'Open'}</h3>
          <ul aria-label={isResolved ? 'Resolved threads' : 'Open threads'}>
            {data.threads
              .filter((thread) => thread.isResolved === isResolved)
              .map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const page = pinPageOf(data, thread);
                      const pages = engine?.pages;
                      if (pages && page !== undefined && page !== pages.current()) pages.show(page);
                      data.select(thread.id);
                    }}
                  >
                    {thread.messages[0]?.text ?? 'Empty thread'}
                  </button>
                  {thread.messages.some((message) => message.mentions.includes(data.user.id)) && (
                    <small>Mentions you</small>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
      {data.error && (
        <p role="alert">
          {data.error}
          <button
            type="button"
            onClick={() => {
              void data.refresh();
            }}
          >
            Try again
          </button>
        </p>
      )}
    </aside>
  );
}

/**
 * Closes the open card on a press outside it and outside the pins (a pin's own click opens its
 * thread). A press that places a new comment closes the card too, and the new one opens.
 *
 * @param isOpen - Whether a card is open.
 * @param marker - An element inside the overlay's container.
 * @param data - The comments, whose `close` closes the card.
 */
function useCloseOnOutsidePress(
  isOpen: boolean,
  marker: RefObject<HTMLElement | null>,
  data: CommentData | undefined,
): void {
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    if (!isOpen || !marker.current) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-comment-card], [data-comment-pin]')) return;
      latest.current?.close();
    };
    // Captured: the canvas's own handlers stop the press before it would bubble here.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen, marker]);
}

/**
 * One at a time (the owner's "commenting and properties panel should not be open at the
 * same time"): selecting objects closes an open thread or placement, however they are selected
 * (a press, the keyboard, search). Opening a thread clears the selection the other way
 * (`useThreadClearsSelection`), and a selection emptied does nothing here.
 *
 * @param hasCard - Whether a thread or placement is open.
 * @param engine - The engine, whose board view reports the selection.
 * @param data - The comments, whose `close` closes the card.
 */
function useSelectionClosesThread(
  hasCard: boolean,
  engine: MountedEngine | undefined,
  data: CommentData | undefined,
): void {
  // The latest comments, so the subscription lasts while the card is open.
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    const view = engine?.board;
    if (!hasCard || view === undefined) return undefined;
    let before = view.state().selectedIds.join(' ');
    return view.subscribe((change) => {
      if (change.kind !== 'selection') return;
      const now = view.state().selectedIds.join(' ');
      if (now !== '' && now !== before) latest.current?.close();
      before = now;
    });
  }, [hasCard, engine]);
}

/**
 * Follows camera positions and captures the placement gesture.
 *
 * @param data - Optional site comments.
 * @param engine - Current engine.
 * @param isPlacing - Whether to capture a click.
 * @param themeName - The theme shown, which a click picks colour tokens in.
 * @returns A DOM marker and serialized pin positions.
 */
function usePinOverlay(
  data: CommentData | undefined,
  engine: MountedEngine | undefined,
  isPlacing: boolean,
  themeName: ThemeName,
) {
  const marker = useRef<HTMLSpanElement>(null);
  // Outlives the loop, which starts again whenever the threads change.
  const motion = useRef(new PinMotion());
  const [encoded, setEncoded] = useState(() =>
    JSON.stringify({ pins: [], width: 0, height: 0 } satisfies PinLayout),
  );
  useEffect(() => {
    if (!data || !engine) return;
    let frame = 0;
    const tick = (): void => {
      setEncoded(positions(data, engine, motion.current, performance.now()));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [data, engine]);
  useEffect(() => {
    const canvas = marker.current?.parentElement?.querySelector('canvas');
    if (!canvas || !data || !engine || !isPlacing) return;
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = screenToWorld(engine.camera(), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      const board = data.connection.store.read();
      const page = engine.pages?.current();
      data.place(commentPlacement(board, point, engine.camera().zoom, themeName, page));
    };
    canvas.addEventListener('pointerdown', down, true);
    const before = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('pointerdown', down, true);
      canvas.style.cursor = before;
    };
  }, [data, engine, isPlacing, themeName]);
  return { marker, encoded };
}
