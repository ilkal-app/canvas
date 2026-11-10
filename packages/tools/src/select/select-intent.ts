import type { HitRectMode, WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

import type { ResizeHandle } from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectPointerType } from './select-input.js';
import type { DoubleTapFit } from './touch-gestures.js';

/**
 * What the select tool's state machine asks for. Selection intents
 * (`select`, `toggle`, `marquee`) replace the selection; transform intents (`move`, `resize`,
 * `rotate`) describe the gesture so far, each measured from the press, and are shown as a
 * preview until `commit` runs the gesture as one command (one undo step) or `cancel` drops it;
 * `nudge` is a whole command of its own; `activate` asks for the object's own interaction (a
 * double press: entering a group, editing a text). `contextMenu`, `doubleTap` and `pan` ask the
 * app for something the document does not hold: the context menu, a zoom to fit, and a pan.
 */
export type SelectIntent =
  | {
      /** Select exactly these ids (a click, a click on empty board with `[]`, Escape). */
      readonly type: 'select';
      /** The ids, first primary. */
      readonly ids: readonly ObjectId[];
    }
  | {
      /** Shift-click: add or remove one id. */
      readonly type: 'toggle';
      /** The id. */
      readonly id: ObjectId;
    }
  | {
      /** A marquee drag so far: the selection becomes `ids`. */
      readonly type: 'marquee';
      /** The marquee, world units. */
      readonly rect: WorldBounds;
      /** `intersect` dragging right, `contain` dragging left. */
      readonly mode: HitRectMode;
      /** What the selection becomes: the marquee's hits, after the earlier selection with Shift. */
      readonly ids: readonly ObjectId[];
    }
  | {
      /** A move drag so far. */
      readonly type: 'move';
      /** The displacement since the press, world units; one axis is 0 when locked. */
      readonly delta: Point;
      /** Whether Shift locked the move to its larger axis. */
      readonly isAxisLocked: boolean;
    }
  | {
      /** A resize-handle drag so far. */
      readonly type: 'resize';
      /** The handle dragged. */
      readonly handle: ResizeHandle;
      /** The pointer's displacement since the press, world units. */
      readonly delta: Point;
      /**
       * Whether the resize keeps an aspect ratio: Shift held, or for an image Shift not held
       * (`ResizeAspect`).
       */
      readonly isProportional: boolean;
      /**
       * The aspect a proportional resize keeps, width over height in the frame's axes: a lone
       * image's drawn aspect; the frame's own when absent.
       */
      readonly aspect?: number;
      /** The selection frame when the drag began. */
      readonly from: OrientedBox;
      /** The frame the drag has resized it to. */
      readonly to: OrientedBox;
    }
  | {
      /** A rotation drag from a corner's rotation band so far. */
      readonly type: 'rotate';
      /** The turn since the press, radians, clockwise on screen. */
      readonly angle: number;
      /** Whether Shift snapped the frame to 15° steps. */
      readonly isSnapped: boolean;
      /** The centre of the turn: the frame's centre when the drag began, world units. */
      readonly pivot: Point;
      /** The selection frame when the drag began. */
      readonly from: OrientedBox;
    }
  | {
      /** An arrow key moved the selection. */
      readonly type: 'nudge';
      /** The displacement, world units. */
      readonly delta: Point;
    }
  | SelectActivation
  | {
      /** The gesture ended: run it as one command. */
      readonly type: 'commit';
    }
  | {
      /** The gesture was abandoned (Escape, pointer lost): drop its preview. */
      readonly type: 'cancel';
    }
  | {
      /**
       * Open the context menu: a long-press or a secondary click, after
       * the intents that selected what it landed on.
       */
      readonly type: 'contextMenu';
      /** Where it opens: the press, CSS px on the viewport. */
      readonly screen: ScreenPoint;
      /** The same point on the board, world units. */
      readonly world: Point;
      /** Whether a finger's long-press asked, not a secondary click; false if absent. */
      readonly isTouch?: boolean;
    }
  | {
      /**
       * A finger's double-tap on empty board, which activates nothing:
       * the app zooms to fit the selection, or the whole board when nothing is selected. It
       * comes on the second tap's release, which clicks nothing else.
       */
      readonly type: 'doubleTap';
      /** What to fit: the selection as the second tap found it, or the board if it was empty. */
      readonly fit: DoubleTapFit;
    }
  | {
      /**
       * A finger dragging from empty board: the app pans the view by the finger's
       * movement since its last report, so the board stays under it. No selection changes and
       * nothing is written, so no `commit` or `cancel` follows.
       */
      readonly type: 'pan';
      /** How far the finger moved right, CSS px. */
      readonly deltaXPx: number;
      /** How far the finger moved down, CSS px. */
      readonly deltaYPx: number;
    };

/**
 * The select tool's `activate` intent: a double press on an object, or Enter with one object
 * selected. A group not yet entered is entered; any other object is handed to the mode
 * registered for its type.
 */
export interface SelectActivation {
  /** Always `activate`. */
  readonly type: 'activate';
  /** The object pressed, as selected at the level the tool is at. */
  readonly id: ObjectId;
  /** Where the second press was, or the selection frame's centre for Enter; world units. */
  readonly world: Point;
  /**
   * `enter` when the Enter key activated the object, so a mode does not treat `world` as a
   * point the person chose (text selects its whole text); absent for a double press.
   */
  readonly source?: 'enter';
  /**
   * The pointer that pressed; `mouse` if absent. A finger's double-tap on an object with
   * nothing to enter or edit zooms to it instead (`TouchCallbacks.canActivate`).
   */
  readonly pointerType?: SelectPointerType;
}
