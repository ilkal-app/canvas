import type { WorldBounds } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

/** A direction an arrow key nudges the selection. */
export type NudgeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * What kind of pointer an input came from, as the DOM's `PointerEvent.pointerType` names it:
 * a `touch` press gets finger-sized handles and rotation
 * bands, a wider click threshold, the long-press and the double-tap.
 */
export type SelectPointerType = 'mouse' | 'pen' | 'touch';

/** A pointer position as the select tool sees it: on screen and on the board. */
export interface SelectPointer {
  /** The pointer, CSS px on the viewport; the click threshold is measured here. */
  readonly screen: ScreenPoint;
  /** The same point on the board (`screenToWorld`), world units. */
  readonly world: Point;
  /** Whether Shift is held: toggle, add, or constrain. */
  readonly isShiftPressed: boolean;
  /**
   * Whether mod is held (⌘ or Control): a press on a frame's background picks the frame
   * instead of starting a marquee.
   */
  readonly isModPressed: boolean;
  /**
   * When the input happened, ms (the DOM event's `timeStamp`, whose clock `performance.now`
   * shares): two presses close in time and place are a double press (`isDoublePress`), and a
   * finger's press held long enough is a long-press (`isLongPress`). Without it no press is part
   * of a double press, and a long-press is timed from 0.
   */
  readonly timeStamp?: number;
  /**
   * Whether the snap modifier is held (Alt, Option on a Mac): a move or resize does not snap
   * while it is. False if absent.
   */
  readonly isSnapSuspended?: boolean;
  /** The kind of pointer; `mouse` if absent. */
  readonly pointerType?: SelectPointerType;
  /** The pen pressure from 0 to 1, when the device senses one (a pen, some touch screens). */
  readonly pressure?: number;
  /**
   * On a pressed move, the samples the browser coalesced into this input before its own point,
   * in order, as world points: the draw tool records the whole path. Absent for none.
   */
  readonly trail?: readonly PointerSample[];
}

/** A sample the browser coalesced into a pointer input: where on the board, and the pressure. */
export interface PointerSample {
  /** The point, world units. */
  readonly world: Point;
  /** The pen pressure from 0 to 1, when the device senses one. */
  readonly pressure?: number;
}

/**
 * Select tool input, normalised from DOM events by the app so this package needs no DOM: the
 * primary button's pointer events (one finger's, for touch), the secondary click (the context
 * menu's), the time a touch press has been held, the pointer's loss (capture lost,
 * `pointercancel`, a second finger), Escape, Enter, and the arrow-key nudges of the shortcut
 * registry.
 */
export type SelectInput =
  | ({
      /** The primary button went down, released, or the pointer moved. */
      readonly kind: 'pointerDown' | 'pointerMove' | 'pointerUp';
    } & SelectPointer)
  | ({
      /**
       * A secondary click (the right button, or Control-click on a Mac): opens the context menu
       * for what it landed on.
       */
      readonly kind: 'contextPress';
    } & SelectPointer)
  | {
      /**
       * Time has passed with the pointer still down: the app sends it `LONG_PRESS_MS` after a
       * touch press, and a press held that long without moving past `LONG_PRESS_SLOP_PX` opens
       * the context menu.
       */
      readonly kind: 'hold';
      /** The time now, ms, on the clock of the press's `timeStamp` (`performance.now`). */
      readonly timeStamp: number;
      /**
       * Where the pointer is now, CSS px on the viewport: a press that has wandered
       * `LONG_PRESS_SLOP_PX` or more from where it landed is no long-press, even where it did
       * not start a drag (the count badge).
       */
      readonly screen: ScreenPoint;
    }
  | {
      /**
       * The pointer was taken away mid-gesture (capture lost, `pointercancel`, a second finger
       * landing for a pan or pinch).
       */
      readonly kind: 'pointerCancel';
    }
  | {
      /** Escape: cancels a gesture, else clears the selection. */
      readonly kind: 'escape';
    }
  | {
      /** Enter: activates the selected object when exactly one is selected. */
      readonly kind: 'enter';
    }
  | {
      /** An arrow key. */
      readonly kind: 'nudge';
      /** Which way. */
      readonly direction: NudgeDirection;
      /** Whether Shift was held: the large nudge. */
      readonly isLarge: boolean;
    };

/** Where the pointer last was, at what zoom, and what the viewport showed: for the cursor at rest. */
export interface PointerView {
  /** The pointer, world units. */
  readonly world: Point;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The world the viewport shows, or undefined when the caller gave none. */
  readonly visible: WorldBounds | undefined;
}
