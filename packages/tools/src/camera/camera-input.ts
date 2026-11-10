import type { Camera, WorldBounds } from '@canvas/engine';

import type { CameraOperation } from './camera-controller.js';
import type { ScreenPoint } from './camera-moves.js';
import { steppedZoom } from './zoom-levels.js';

/** How far an arrow key pans the view, CSS px. */
export const KEYBOARD_PAN_PX = 100;

/** How far Shift and an arrow key pan the view, CSS px. */
export const KEYBOARD_PAN_LARGE_PX = 500;

/** The margin zoom to fit and zoom to selection keep on each side, CSS px. */
export const FIT_PADDING_PX = 48;

/**
 * Chrome encodes a trackpad pinch as Control-wheel events with `deltaY = −100 · ln(scale)`, so
 * `exp(−deltaY / 100)` recovers the pinch's scale; the prototype zoomed mouse wheels by the same
 * rule (webgl-whiteboard `src/app/controller.ts`, `onWheel`).
 */
const WHEEL_DELTA_PER_LOG_ZOOM = 100;

/** A direction the view pans in, as an arrow key names it. */
export type PanDirection = 'up' | 'down' | 'left' | 'right';

/** A keyboard zoom command. */
export type KeyZoomCommand =
  'zoomIn' | 'zoomOut' | 'zoomToActualSize' | 'zoomToFit' | 'zoomToSelection';

/**
 * Camera input, normalised from DOM events by the app so this package needs no DOM: wheel
 * deltas in CSS px (`wheelDeltaPx`), points in CSS px on the viewport.
 */
export type CameraInput =
  | {
      /** A wheel event (a mouse wheel, a trackpad scroll, or a trackpad pinch). */
      readonly kind: 'wheel';
      /** The cursor, CSS px on the viewport. */
      readonly point: ScreenPoint;
      /** Horizontal scroll, CSS px; positive scrolls right. */
      readonly deltaXPx: number;
      /** Vertical scroll, CSS px; positive scrolls down. */
      readonly deltaYPx: number;
      /** Whether Control or ⌘ was held (a trackpad pinch holds Control): zoom, not pan. */
      readonly isZoomModifierPressed: boolean;
    }
  | {
      /** A pinch step: two fingers' span changed by `scale` about `center`. */
      readonly kind: 'pinch';
      /** The fingers' midpoint, CSS px on the viewport. */
      readonly center: ScreenPoint;
      /** The span's ratio since the last step; above 1 spreads the fingers. */
      readonly scale: number;
    }
  | {
      /** A drag that pans: two fingers moving together, or the middle mouse button. */
      readonly kind: 'drag';
      /** How far the pointer moved right, CSS px. */
      readonly deltaXPx: number;
      /** How far the pointer moved down, CSS px. */
      readonly deltaYPx: number;
    }
  | {
      /** An arrow key panning the view. */
      readonly kind: 'keyPan';
      /** Which way the view moves; the board moves the other way. */
      readonly direction: PanDirection;
      /** Whether Shift was held: pan {@link KEYBOARD_PAN_LARGE_PX}, not {@link KEYBOARD_PAN_PX}. */
      readonly isLarge: boolean;
    }
  | {
      /** A zoom key. */
      readonly kind: 'keyZoom';
      /** Which command. */
      readonly command: KeyZoomCommand;
    }
  | {
      /** Frame a world rectangle, as zoom to fit does the board (a comment cluster). */
      readonly kind: 'frame';
      /** The rectangle, world units. */
      readonly bounds: WorldBounds;
    };

/** What the input mapper needs to know about the board and the view. */
export interface CameraInputContext {
  /** The camera now; keyboard zoom steps from its zoom. */
  readonly camera: Camera;
  /** The bounds of everything on the board, or undefined when it is empty. */
  readonly contentBounds: WorldBounds | undefined;
  /** The bounds of the selection, or undefined when nothing is selected. */
  readonly selectionBounds: WorldBounds | undefined;
}

const PAN_VECTORS: Readonly<Record<PanDirection, readonly [number, number]>> = {
  up: [0, 1],
  down: [0, -1],
  left: [1, 0],
  right: [-1, 0],
};

/**
 * The input mapper: turns one normalised input into the camera operation it means: Control/⌘-wheel
 * zooms about the cursor, a plain wheel pans, a pinch zooms about its midpoint, a two-finger or
 * middle-button drag pans, arrows pan, `+`/`-`/`0` zoom and Shift+1 / Shift+2 fit the board or the
 * selection, and a frame fits the rectangle it names. Pure.
 *
 * @param input - The input.
 * @param context - The camera and the board's and selection's bounds.
 * @returns The operation, or undefined when the input means nothing to the camera.
 */
export function cameraOperationFor(
  input: CameraInput,
  context: CameraInputContext,
): CameraOperation | undefined {
  switch (input.kind) {
    case 'wheel':
      return input.isZoomModifierPressed
        ? {
            type: 'zoomAt',
            point: input.point,
            factor: Math.exp(-input.deltaYPx / WHEEL_DELTA_PER_LOG_ZOOM),
          }
        : { type: 'panBy', deltaXPx: -input.deltaXPx, deltaYPx: -input.deltaYPx };
    case 'pinch':
      return { type: 'zoomAt', point: input.center, factor: input.scale };
    case 'drag':
      return { type: 'panBy', deltaXPx: input.deltaXPx, deltaYPx: input.deltaYPx };
    case 'keyPan': {
      const [x, y] = PAN_VECTORS[input.direction];
      const distancePx = input.isLarge ? KEYBOARD_PAN_LARGE_PX : KEYBOARD_PAN_PX;
      return { type: 'panBy', deltaXPx: x * distancePx, deltaYPx: y * distancePx };
    }
    case 'keyZoom':
      return keyZoomOperation(input.command, context);
    case 'frame':
      return { type: 'fitToRect', bounds: input.bounds, paddingPx: FIT_PADDING_PX };
  }
}

function keyZoomOperation(command: KeyZoomCommand, context: CameraInputContext): CameraOperation {
  switch (command) {
    case 'zoomIn':
      return { type: 'zoomTo', zoom: steppedZoom(context.camera.zoom, 'in') };
    case 'zoomOut':
      return { type: 'zoomTo', zoom: steppedZoom(context.camera.zoom, 'out') };
    case 'zoomToActualSize':
      return { type: 'zoomTo', zoom: 1 };
    case 'zoomToFit':
      return context.contentBounds === undefined
        ? { type: 'resetToOrigin' }
        : { type: 'fitToRect', bounds: context.contentBounds, paddingPx: FIT_PADDING_PX };
    case 'zoomToSelection':
      return { type: 'fitToSelection', bounds: context.selectionBounds, paddingPx: FIT_PADDING_PX };
  }
}
