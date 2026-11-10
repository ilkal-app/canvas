import type { Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';
import type { SnapSettings } from '../select/drag-snap.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectCursor } from '../select/select-cursor.js';
import type { NudgeDirection, SelectPointer } from '../select/select-input.js';

import type { ToolId } from './tool-ids.js';

/**
 * Pointer input as a tool mode takes it: the select tool's pointer input (screen and world
 * point, modifiers, time) plus the camera zoom, so a mode sizes what it shows on screen, and the
 * camera itself where the caller has it (the select tool keeps its count badge inside the view);
 * a secondary click and a held finger too, which only the select tool uses (its context menu).
 * Normalised from DOM events by the app, like the select tool's.
 */
export type ToolPointerInput =
  | ({
      /**
       * The primary button (or one finger) went down, released, or the pointer moved (pressed or
       * hovering); or a secondary click asked for the context menu (`contextPress`).
       */
      readonly kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'contextPress';
      /** The camera zoom, CSS px per world unit. */
      readonly zoom: number;
      /** The camera now, when the caller has it. */
      readonly camera?: Camera;
      /**
       * How drags snap (the person's preferences), when the caller has
       * them; no snapping when absent.
       */
      readonly snapping?: SnapSettings;
    } & SelectPointer)
  | {
      /** A finger has stayed down, within the long-press slop, for the long-press time. */
      readonly kind: 'hold';
      /** The time now, ms, on the press's `timeStamp` clock. */
      readonly timeStamp: number;
      /** Where the finger is now, CSS px on the canvas. */
      readonly screen: ScreenPoint;
      /** The camera zoom, CSS px per world unit. */
      readonly zoom: number;
    }
  | {
      /** The pointer was taken away mid-gesture (capture lost, `pointercancel`). */
      readonly kind: 'pointerCancel';
    };

/**
 * The canvas keys a tool mode can take from the shortcut registry, the ones the select tool
 * takes otherwise: Escape, Enter, Delete (with Shift: delete and heal), select all and the arrow
 * keys. Typing does not arrive
 * here: a mode that edits text takes it from its own input element.
 */
export type ToolKeyInput =
  | {
      /** Which key. */
      readonly kind: 'escape' | 'enter' | 'selectAll';
    }
  | {
      /** Delete or Backspace. */
      readonly kind: 'delete';
      /**
       * Whether Shift was held: vector edit deletes the selected points and heals the gaps.
       * False if absent.
       */
      readonly isHealing?: boolean;
    }
  | {
      /** An arrow key. */
      readonly kind: 'nudge';
      /** Which way. */
      readonly direction: NudgeDirection;
      /** Whether Shift was held. */
      readonly isLarge: boolean;
    };

/** What a tool mode did with a pointer input. */
export interface ToolStep {
  /** Whether the mode has finished: the router then calls `exit` and makes select active. */
  readonly isDone: boolean;
  /**
   * When the mode finished on this input, whether the select tool takes the same input next (a
   * click outside the text being edited commits it and then selects what it lands on).
   */
  readonly isPassedOn?: boolean;
  /**
   * Whether the mode has already shown what the input changed (the select tool reports through
   * its controller's own `onChange`), so the router does not redraw a second time; absent, the
   * router redraws after the step.
   */
  readonly isShown?: boolean;
}

/** A step that keeps the mode active. */
export const TOOL_STEP_CONTINUE: ToolStep = Object.freeze({ isDone: false });

/**
 * The cursor a tool mode asks for: the select tool's, the I-beam over text, a crosshair (the
 * pen), vector editing's `pointer` over a vertex or handle and `move` over a segment or while
 * dragging, or the hand's `grab`, `grabbing` while it pans.
 */
export type ToolCursor =
  SelectCursor | 'text' | 'crosshair' | 'pointer' | 'move' | 'grab' | 'grabbing';

/**
 * An interaction mode other than the select tool: text, sticky, pen, shape, line and image tools,
 * and editing modes entered by activating an object (a double-click on text edits it). The app's
 * tool router gives the active mode the primary button and the canvas keys, with the select tool
 * active when no mode is; a mode runs on the page against the document, never in the engine
 * worker, and shows what it draws through the overlay model, which the engine draws. Its pure core
 * is DOM-free and unit-tested; the app normalises input for it. Main thread.
 */
export interface ToolMode {
  /** The toolbar tool the mode belongs to: the shell shows it as the active tool. */
  readonly id: ToolId;
  /** The cursor the mode asks for now; read after each input. */
  readonly cursor: ToolCursor;
  /**
   * Takes one pointer input.
   *
   * @param input - The input, with its screen and world points and the zoom.
   * @returns Whether the mode is done, and whether the select tool takes the input next.
   */
  onPointer(input: ToolPointerInput): ToolStep;
  /**
   * Takes one canvas key.
   *
   * @param input - The key.
   * @returns Whether the mode used it; if not, the router gives it to the select tool.
   */
  onKey(input: ToolKeyInput): boolean;
  /**
   * What the mode adds to the overlay now; the router lays it over the select tool's model
   * (`toolRects` appended to the select tool's, other fields replaced).
   *
   * @returns The fields to show.
   */
  overlay(): Partial<SelectionOverlayModel>;
  /**
   * Told when the camera zoom changed with no input (a wheel zoom, a fit), so what the mode
   * sizes on screen (a caret, handles) can follow; optional.
   *
   * @param zoom - The camera zoom now, CSS px per world unit.
   */
  onZoom?(zoom: number): void;
  /**
   * Brings the resting cursor up to date after the camera moved under a still pointer (a wheel
   * zoom, a pan, a fit): the pointer's last canvas point is a new world point; optional.
   *
   * @param world - Where the pointer is now, world units.
   * @param camera - The camera now.
   */
  refreshCursor?(world: Point, camera: Camera): void;
  /**
   * Offered the toolbar's tool change while the mode runs, before the mode is ended: a mode with
   * sub-tools (vector editing's move and pen) returns the mode that goes on with the same
   * session as that tool, which takes over without this one's `exit` (this mode drops what it
   * shows itself). `undefined`, or no method, ends the mode as usual. The returned mode's `id`
   * is the tool the toolbar shows, which may differ from the one asked for (the pen keeps a lone
   * first point rather than switching to move). Optional.
   *
   * @param tool - The tool the toolbar made active.
   * @returns The mode that continues, or `undefined` to end this one.
   */
  onToolSwitch?(tool: ToolId): ToolMode | undefined;
  /** Ends the mode: commits or drops what it was doing and stops listening. Called once. */
  exit(): void;
  /**
   * Ends the mode writing nothing to the document, instead of {@link ToolMode.exit}: what it has
   * not written is dropped (text typed while the fonts load, a path left without a segment, a
   * crop, an empty text's delete), for a person who can no longer edit the board. What
   * it wrote before stays. Optional: a mode whose `exit` writes nothing is ended with `exit`.
   */
  abandon?(): void;
}
