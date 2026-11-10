import { isSameCamera, type Camera, type WorldBounds } from '@canvas/engine';
import { applyCameraOperation, cameraOperationFor, type CameraInput } from '@canvas/tools';

import { FIT_TRANSITION_MS } from './engine-glide.js';

/** Where a camera input takes the camera, and how long the glide there lasts. */
export interface CameraInputPlan {
  /** The camera after the input. */
  readonly next: Camera;
  /** How long to glide there, ms; 0 jumps. */
  readonly durationMs: number;
}

/** The bounds a fit reads: the board's content and the selection. */
export interface CameraInputBounds {
  /**
   * The bounds of everything on the board.
   *
   * @returns World units, or undefined for an empty board.
   */
  contentBounds(): WorldBounds | undefined;
  /**
   * The bounds of the selection.
   *
   * @returns World units, or undefined with nothing selected.
   */
  selectionBounds(): WorldBounds | undefined;
}

/**
 * Plans a camera input (`cameraOperationFor`, `applyCameraOperation` of `@canvas/tools`) from
 * the camera on screen: the fits glide for {@link FIT_TRANSITION_MS} unless the person prefers
 * reduced motion; every other operation jumps. Main thread.
 *
 * @param input - The camera input.
 * @param from - The camera on screen, mid-glide included.
 * @param bounds - The board's content and selection bounds, for the fits.
 * @param prefersReducedMotion - Whether to jump instead of gliding.
 * @returns The plan, or undefined when the input moves nothing.
 */
export function planCameraInput(
  input: CameraInput,
  from: Camera,
  bounds: CameraInputBounds,
  prefersReducedMotion: () => boolean,
): CameraInputPlan | undefined {
  const operation = cameraOperationFor(input, {
    camera: from,
    contentBounds: bounds.contentBounds(),
    selectionBounds: bounds.selectionBounds(),
  });
  if (operation === undefined) return undefined;
  const next = applyCameraOperation(from, operation);
  if (isSameCamera(next, from)) return undefined;
  const isFit = operation.type === 'fitToRect' || operation.type === 'fitToSelection';
  return { next, durationMs: isFit && !prefersReducedMotion() ? FIT_TRANSITION_MS : 0 };
}
