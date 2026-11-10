import type { ScreenPoint, SelectPointerType } from '@canvas/tools';

import { LongPressTimer } from './long-press-timer.js';
import { coalescedTrailOf, pressureOf, type ScreenSample } from './pointer-samples.js';

/** The primary mouse button (and a pen's contact, and a finger's). */
const PRIMARY_BUTTON = 0;

/** A pointer's position and modifiers as the select tool takes them, before the world point. */
export interface ScreenPointer {
  /** The pointer, CSS px on the canvas. */
  readonly screen: ScreenPoint;
  /** Whether Shift is held. */
  readonly isShiftPressed: boolean;
  /** Whether mod is held: ⌘ or Control, either on any platform (as the camera's zoom modifier). */
  readonly isModPressed: boolean;
  /** The kind of pointer; `mouse` if absent. */
  readonly pointerType?: SelectPointerType;
  /**
   * When, ms (the event's `timeStamp`, on `performance.now`'s clock): the select tool times
   * double presses and long-presses with it.
   */
  readonly timeStamp?: number;
  /**
   * Whether the snap modifier is held: Alt (Option on a Mac) on every platform, since Control
   * is mod on a Mac for this binding; a drag does not snap while it is.
   */
  readonly isSnapSuspended?: boolean;
  /** A pen's pressure from 0 to 1, or a finger's where the screen senses it (`pressureOf`). */
  readonly pressure?: number;
  /**
   * On a pressed move, the samples the browser coalesced into the event before its own point,
   * in order (`coalescedTrailOf`); absent when there were none. The draw tool records them.
   */
  readonly trail?: readonly ScreenSample[];
}

/**
 * Pointer input as the select tool takes it, before the engine adds the world point: CSS px on
 * the canvas.
 */
export type ScreenPointerInput =
  | ({
      /**
       * The primary button or one finger went down, the pointer moved (while down, or a mouse or
       * pen hovering with no press, for the select tool's cursor), or it was released; or a
       * secondary click asked for the context menu (`contextPress`).
       */
      readonly kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'contextPress';
    } & ScreenPointer)
  | {
      /** A finger has stayed down, within `LONG_PRESS_SLOP_PX`, for `LONG_PRESS_MS`. */
      readonly kind: 'hold';
      /** The time now, ms, on the press's `timeStamp` clock. */
      readonly timeStamp: number;
      /** Where the finger is now, CSS px on the canvas. */
      readonly screen: ScreenPoint;
    }
  | {
      /**
       * The pointer was taken away mid-press (`pointercancel`, its capture was lost, or a second
       * finger landed for the camera's pan and pinch).
       */
      readonly kind: 'pointerCancel';
    };

/** What {@link bindSelectInput} may be given; tests inject the clock. */
export interface SelectInputBindingOptions {
  /**
   * The time now, ms, on the clock of events' `timeStamp`; `performance.now` if absent. The
   * long-press's `hold` reads it.
   */
  readonly clock?: () => number;
}

function pointerTypeOf(event: MouseEvent): SelectPointerType {
  const type = 'pointerType' in event ? event.pointerType : 'mouse';
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

function performanceNow(): number {
  return performance.now();
}

/**
 * The modifiers and time an event carries (Alt suspends snapping): a pointer event's, or a
 * modifier key's mid-drag.
 *
 * @param event - The event.
 * @returns Shift, mod, the snap modifier and the event's `timeStamp`.
 */
function modifiersOf(
  event: MouseEvent | KeyboardEvent,
): Pick<ScreenPointer, 'isShiftPressed' | 'isModPressed' | 'isSnapSuspended' | 'timeStamp'> {
  return {
    isShiftPressed: event.shiftKey,
    isModPressed: event.metaKey || event.ctrlKey,
    timeStamp: event.timeStamp,
    ...(event.altKey ? { isSnapSuspended: true } : {}),
  };
}

/**
 * The select binding's pointer state: which pointer the tool has, the fingers down, and the
 * long-press timer. One per canvas. Main thread.
 */
class SelectPointerBinding {
  private readonly canvas: HTMLCanvasElement;
  private readonly onInput: (input: ScreenPointerInput) => void;
  /** Fingers on the canvas now; while more than one, none is the tool's. */
  private readonly touches = new Set<number>();
  private pressedPointerId: number | undefined;
  /** The pressed pointer's last report, for a modifier that changes while it stands still. */
  private lastPressed: ScreenPointer | undefined;
  readonly hold: LongPressTimer;

  constructor(
    canvas: HTMLCanvasElement,
    onInput: (input: ScreenPointerInput) => void,
    clock: () => number,
  ) {
    this.canvas = canvas;
    this.onInput = onInput;
    this.hold = new LongPressTimer((timeStamp, screen) => {
      onInput({ kind: 'hold', timeStamp, screen });
      // The tool opened the context menu and is at rest: the rest of this finger is ignored
      // until it lifts, and no other finger is the tool's while it is down.
      this.pressedPointerId = undefined;
      this.lastPressed = undefined;
    }, clock);
  }

  /**
   * The pointer an event reports: a hover carries no pressure (a pen reports 0 in the air), a
   * pressed move its coalesced samples too.
   *
   * @param event - The event.
   * @param motion - Whether it is a hover, a pressed move, or another input (a press, a release).
   * @returns The pointer, CSS px on the canvas.
   */
  pointerOf(event: MouseEvent, motion: 'hover' | 'pressedMove' | 'other' = 'other'): ScreenPointer {
    const box = this.canvas.getBoundingClientRect();
    const pressure = motion === 'hover' ? undefined : pressureOf(event);
    const trail = motion === 'pressedMove' ? coalescedTrailOf(event as PointerEvent, box) : [];
    return {
      screen: { x: event.clientX - box.left, y: event.clientY - box.top },
      ...modifiersOf(event),
      pointerType: pointerTypeOf(event),
      ...(pressure === undefined ? {} : { pressure }),
      ...(trail.length === 0 ? {} : { trail }),
    };
  }

  /**
   * A finger landing: the first one of a touch sequence (primary) finds no finger down, so any
   * left over from a sequence whose lift was never seen are dropped. A second finger takes the
   * gesture for the camera, ending the first finger's press without writing.
   *
   * @param event - The finger's `pointerdown`.
   * @returns Whether it is the only finger down, so the tool may take it.
   */
  landFinger(event: PointerEvent): boolean {
    if (event.isPrimary) this.touches.clear();
    this.touches.add(event.pointerId);
    if (this.touches.size === 1) return true;
    const pressed = this.pressedPointerId;
    if (pressed !== undefined && this.touches.has(pressed)) this.cancelPress();
    return false;
  }

  onPointerDown(event: PointerEvent): void {
    const isTouch = event.pointerType === 'touch';
    if (isTouch ? !this.landFinger(event) : event.button !== PRIMARY_BUTTON) return;
    if (this.pressedPointerId !== undefined) return;
    this.pressedPointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    const pointer = this.pointerOf(event);
    this.lastPressed = pointer;
    this.onInput({ kind: 'pointerDown', ...pointer });
    if (isTouch) this.hold.start(event.timeStamp, pointer.screen);
  }

  onPointerMove(event: PointerEvent): void {
    const isHovering = this.pressedPointerId === undefined && event.pointerType !== 'touch';
    if (event.pointerId !== this.pressedPointerId && !isHovering) return;
    const pointer = this.pointerOf(event, isHovering ? 'hover' : 'pressedMove');
    if (!isHovering) {
      this.hold.follow(pointer.screen);
      this.lastPressed = pointer;
    }
    this.onInput({ kind: 'pointerMove', ...pointer });
  }

  onPointerUp(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    if (event.pointerId !== this.pressedPointerId || event.button !== PRIMARY_BUTTON) return;
    this.finishPress(event);
  }

  /**
   * Alt or Shift pressed or released mid-drag, with the pointer still: the drag step is taken
   * again at the same point with the new modifiers, so snapping (and Shift's constraints) follow
   * the key at once rather than at the next pointer move.
   *
   * @param event - The key's `keydown` or `keyup`.
   */
  onModifier(event: KeyboardEvent): void {
    if (event.key !== 'Alt' && event.key !== 'Shift') return;
    const pressed = this.lastPressed;
    if (this.pressedPointerId === undefined || pressed === undefined) return;
    const { screen, pointerType, pressure } = pressed;
    this.onInput({
      kind: 'pointerMove',
      screen,
      ...modifiersOf(event),
      ...(pointerType === undefined ? {} : { pointerType }),
      ...(pressure === undefined ? {} : { pressure }),
    });
  }

  /**
   * A cancelled pointer or capture lost mid-press cancels. Chrome can report mouse capture
   * loss with no buttons down before pointerup; that release finishes the press once.
   *
   * @param event - The event.
   */
  onPointerLost(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    if (event.pointerId !== this.pressedPointerId) return;
    if (
      event.type === 'lostpointercapture' &&
      event.pointerType === 'mouse' &&
      event.buttons === 0
    ) {
      this.finishPress(event);
      return;
    }
    this.cancelPress();
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (pointerTypeOf(event) === 'touch' || this.touches.size > 0) return;
    this.onInput({ kind: 'contextPress', ...this.pointerOf(event) });
  }

  private cancelPress(): void {
    this.hold.stop();
    this.pressedPointerId = undefined;
    this.lastPressed = undefined;
    this.onInput({ kind: 'pointerCancel' });
  }

  private finishPress(event: PointerEvent): void {
    this.hold.stop();
    this.pressedPointerId = undefined;
    this.lastPressed = undefined;
    this.onInput({ kind: 'pointerUp', ...this.pointerOf(event) });
  }
}

/**
 * Listens to the canvas's pointer input for the select tool and reports it in CSS px on the
 * canvas. The primary mouse button, a pen and one finger drive the
 * tool alike, each input with its pointer type, its modifiers (Alt suspends snapping) and the
 * event's `timeStamp`, and a pen's pressure (`pressureOf`); a pressed move carries the samples the
 * browser coalesced into it (`coalescedTrailOf`), for the draw tool. Alt or Shift changing
 * mid-drag reports the drag step again where the pointer stands. A press captures the pointer
 * (`setPointerCapture`), so a drag that leaves the canvas keeps its moves and its release; a
 * cancelled pointer or capture lost mid-press is reported as `pointerCancel`. Mouse capture loss
 * with no buttons down finishes the release even if it precedes pointerup. Moves are reported
 * while the press lasts, and while a mouse or pen hovers with no press under way, so the select
 * tool can show its rotate cursor over a selection's corner band.
 *
 * Touch: a finger's press starts a `LONG_PRESS_MS` timer (`LongPressTimer`) that reports `hold`
 * unless the finger wanders `LONG_PRESS_SLOP_PX` first; the tool then opens the context menu
 * and is at rest, and the rest of that finger is ignored. A second finger landing cancels the
 * first finger's press (the camera's two-finger pan and pinch take over, `bindCameraInput`), and
 * no finger is the tool's again until every finger has lifted, been cancelled or lost its
 * capture. The browser's own context menu never opens over the canvas; a mouse or pen secondary
 * click reports `contextPress` instead (a finger's long-press is the tool's own, so the
 * browser's is ignored). Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param onInput - Receives each input, in event order.
 * @param options - The clock.
 * @returns A function that removes the listeners and stops the timer.
 */
export function bindSelectInput(
  canvas: HTMLCanvasElement,
  onInput: (input: ScreenPointerInput) => void,
  options: SelectInputBindingOptions = {},
): () => void {
  const binding = new SelectPointerBinding(canvas, onInput, options.clock ?? performanceNow);
  const onPointerDown = (event: PointerEvent): void => {
    binding.onPointerDown(event);
  };
  const onPointerMove = (event: PointerEvent): void => {
    binding.onPointerMove(event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    binding.onPointerUp(event);
  };
  const onPointerLost = (event: PointerEvent): void => {
    binding.onPointerLost(event);
  };
  const onContextMenu = (event: MouseEvent): void => {
    binding.onContextMenu(event);
  };
  const onModifier = (event: KeyboardEvent): void => {
    binding.onModifier(event);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerLost);
  canvas.addEventListener('lostpointercapture', onPointerLost);
  canvas.addEventListener('contextmenu', onContextMenu);
  // The page the canvas is on hears the keys; a canvas outside any page (tests) has none.
  const page = (canvas.ownerDocument as Document | undefined)?.defaultView ?? undefined;
  page?.addEventListener('keydown', onModifier);
  page?.addEventListener('keyup', onModifier);
  return () => {
    binding.hold.stop();
    page?.removeEventListener('keydown', onModifier);
    page?.removeEventListener('keyup', onModifier);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerLost);
    canvas.removeEventListener('lostpointercapture', onPointerLost);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
