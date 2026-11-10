import type { Camera, WorldBounds } from '@canvas/engine';

import {
  fitCameraToRect,
  panCamera,
  resetCameraToOrigin,
  zoomCameraAt,
  zoomCameraTo,
  type ScreenPoint,
} from './camera-moves.js';

/**
 * One thing the camera can be asked to do: the camera controller's
 * vocabulary. Input (wheel, pinch, drag, keys) becomes operations through `cameraOperationFor`;
 * `applyCameraOperation` carries them out.
 */
export type CameraOperation =
  | {
      /** Move the board on screen by a drag. */
      readonly type: 'panBy';
      /** How far the board moves right, CSS px. */
      readonly deltaXPx: number;
      /** How far the board moves down, CSS px. */
      readonly deltaYPx: number;
    }
  | {
      /** Zoom by a factor about a screen point, which stays fixed. */
      readonly type: 'zoomAt';
      /** The fixed point, CSS px on the viewport. */
      readonly point: ScreenPoint;
      /** The zoom multiplier; above 1 zooms in. */
      readonly factor: number;
    }
  | {
      /** Set the zoom level about the viewport centre. */
      readonly type: 'zoomTo';
      /** The zoom, CSS px per world unit; clamped. */
      readonly zoom: number;
    }
  | {
      /** Frame a world rectangle (zoom to fit). */
      readonly type: 'fitToRect';
      /** The rectangle, world units. */
      readonly bounds: WorldBounds;
      /** The margin on each side, CSS px. */
      readonly paddingPx: number;
    }
  | {
      /** Frame the selection; nothing happens when nothing is selected. */
      readonly type: 'fitToSelection';
      /** The selection's bounds, world units, or undefined when nothing is selected. */
      readonly bounds: WorldBounds | undefined;
      /** The margin on each side, CSS px. */
      readonly paddingPx: number;
    }
  | {
      /** Return to the origin at 100%. */
      readonly type: 'resetToOrigin';
    };

/**
 * The camera controller: applies an operation to a camera and returns the next camera. Pure:
 * the state is the `Camera` value, and the input camera is never changed. Zoom is always
 * clamped to 0.02×–64× (`clampZoom`).
 *
 * @param camera - The current camera.
 * @param operation - What to do.
 * @returns The next camera; the same object when the operation changes nothing.
 * @throws {RangeError} When the operation's numbers are out of range (a non-positive zoom
 *   factor, inverted fit bounds, a negative padding).
 */
export function applyCameraOperation(camera: Camera, operation: CameraOperation): Camera {
  switch (operation.type) {
    case 'panBy':
      return panCamera(camera, operation.deltaXPx, operation.deltaYPx);
    case 'zoomAt':
      return zoomCameraAt(camera, operation.point, operation.factor);
    case 'zoomTo':
      return zoomCameraTo(camera, operation.zoom);
    case 'fitToRect':
      return fitCameraToRect(camera, operation.bounds, operation.paddingPx);
    case 'fitToSelection':
      return operation.bounds === undefined
        ? camera
        : fitCameraToRect(camera, operation.bounds, operation.paddingPx);
    case 'resetToOrigin':
      return resetCameraToOrigin(camera);
  }
}
