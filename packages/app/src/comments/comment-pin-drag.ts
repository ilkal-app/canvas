import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** A point on the canvas, CSS px. */
interface CanvasPoint {
  /** Across. */
  readonly x: number;
  /** Down. */
  readonly y: number;
}

/** How far a press moves before it is a drag rather than a click, CSS px. */
const DRAG_DISTANCE = 4;

/** What a draggable pin needs from {@link usePinDrag}. */
export interface PinDrag {
  /** Where the pin shows now: under the pointer while dragged, where it was dropped until saved. */
  readonly at: CanvasPoint | undefined;
  /** Starts watching a press on the pin. */
  readonly onPointerDown: (event: ReactPointerEvent) => void;
  /**
   * Whether the click that ends a press is the end of a drag, not a click, and clears it.
   *
   * @returns True once after a drag (a dropped or cancelled one).
   */
  readonly takeDragged: () => boolean;
}

/**
 * Lets the person drag a pin to move it: a press that moves 4 CSS px or more follows
 * the pointer and, released, is dropped (`onDrop`, with the drop's canvas point), the pin held
 * there until the drop is saved or refused; Escape cancels it. A press that moves less stays a
 * click. One pointer's press at a time: a cancelled pointer (a touch scroll) drops the drag
 * unsaved, and the pin's unmounting ends it. Nothing for a pin the person may not move.
 *
 * @param pin - The pin's canvas point now.
 * @param canDrag - Whether the person may move it.
 * @param onDrop - Saves the pin at a canvas point; settles once saved or refused.
 * @returns The drag.
 */
export function usePinDrag(
  pin: CanvasPoint,
  canDrag: boolean,
  onDrop: (point: CanvasPoint) => Promise<void>,
): PinDrag {
  const [dragged, setDragged] = useState<CanvasPoint>();
  const [held, setHeld] = useState<CanvasPoint>();
  const wasDragged = useRef(false);
  // Ends the press being watched, if any: its listeners go with the pin.
  const stopWatching = useRef<() => void>(undefined);
  useEffect(
    () => () => {
      stopWatching.current?.();
    },
    [],
  );
  const onPointerDown = (event: ReactPointerEvent): void => {
    if (!canDrag || event.button !== 0) return;
    stopWatching.current?.();
    // A new press: an earlier drag that ended off the pin (no click followed) no longer counts.
    wasDragged.current = false;
    stopWatching.current = watchPress(event, pin, {
      drag: (point) => {
        wasDragged.current = true;
        setDragged(point);
      },
      end: () => {
        stopWatching.current = undefined;
        setDragged(undefined);
      },
      drop: (point) => {
        setHeld(point);
        void onDrop(point).finally(() => {
          setHeld(undefined);
        });
      },
    });
  };
  return {
    at: dragged ?? held,
    onPointerDown,
    takeDragged: () => {
      const was = wasDragged.current;
      wasDragged.current = false;
      return was;
    },
  };
}

/** What a watched press tells its pin. */
interface PressSinks {
  /** The pin is dragged to a canvas point. */
  readonly drag: (point: CanvasPoint) => void;
  /** The drag is over: dropped, cancelled or lost. */
  readonly end: () => void;
  /** The pin was dropped at a canvas point. */
  readonly drop: (point: CanvasPoint) => void;
}

/**
 * Watches one pointer's press on a pin (`usePinDrag`): past 4 CSS px it drags the pin by the
 * pointer's movement; released, it drops it; Escape cancels the drag (and only that), and a
 * cancelled pointer (a touch scroll, a lost window) drops it unsaved.
 *
 * @param event - The press.
 * @param from - The pin's canvas point when pressed.
 * @param sinks - What the pin is told.
 * @returns A function that stops watching, the drag dropped unsaved.
 */
function watchPress(event: ReactPointerEvent, from: CanvasPoint, sinks: PressSinks): () => void {
  const { pointerId } = event;
  const start = { x: event.clientX, y: event.clientY };
  let isDragging = false;
  let isCancelled = false;
  const at = (moved: PointerEvent): CanvasPoint => ({
    x: from.x + moved.clientX - start.x,
    y: from.y + moved.clientY - start.y,
  });
  const move = (moved: PointerEvent): void => {
    if (moved.pointerId !== pointerId || isCancelled) return;
    const distance = Math.hypot(moved.clientX - start.x, moved.clientY - start.y);
    if (!isDragging && distance < DRAG_DISTANCE) return;
    isDragging = true;
    sinks.drag(at(moved));
  };
  const cancel = (key: KeyboardEvent): void => {
    if (key.key !== 'Escape' || !isDragging || isCancelled) return;
    // The drag's Escape only cancels it: it neither closes a card nor leaves a tool.
    key.stopPropagation();
    key.preventDefault();
    isCancelled = true;
    sinks.end();
  };
  const lose = (lost: PointerEvent): void => {
    if (lost.pointerId === pointerId) stop();
  };
  const release = (up: PointerEvent): void => {
    if (up.pointerId !== pointerId) return;
    stop();
    if (isDragging && !isCancelled) sinks.drop(at(up));
  };
  function stop(): void {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', release);
    document.removeEventListener('pointercancel', lose);
    document.removeEventListener('keydown', cancel, true);
    sinks.end();
  }
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', lose);
  document.addEventListener('keydown', cancel, true);
  return stop;
}
