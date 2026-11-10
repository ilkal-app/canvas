import type { Camera } from '../../camera/camera.js';

/** A point on the board a benchmark centres on, world units. */
export interface BenchPoint {
  /** Horizontal position, world units. */
  readonly x: number;
  /** Vertical position, world units. */
  readonly y: number;
}

/** The zoom sweep's range: a continuous zoom sweep from 0.05× to 32×. */
export const ZOOM_SWEEP = {
  /** The widest view, screen px per world unit. */
  fromZoom: 0.05,
  /** The closest view, screen px per world unit. */
  toZoom: 32,
} as const;

/** A viewport the camera fills: CSS px and the device pixel ratio. */
export interface CameraViewport {
  /** Width, CSS px. */
  readonly widthPx: number;
  /** Height, CSS px. */
  readonly heightPx: number;
  /** Device pixels per CSS pixel. */
  readonly dpr: number;
}

/** One animated move of the camera. */
export interface CameraLeg {
  /** Where the camera ends. */
  readonly camera: Camera;
  /** How long the move takes, ms. */
  readonly durationMs: number;
}

/** The zoom sweep as camera moves. */
export interface ZoomSweep {
  /** The camera to start from. */
  readonly start: Camera;
  /** The moves, in order. */
  readonly legs: CameraLeg[];
}

/**
 * The camera that shows `centre` in the middle of the viewport at `zoom`.
 *
 * @param centre - The world point at the viewport's centre.
 * @param zoom - Screen pixels per world unit.
 * @param viewport - The viewport.
 * @returns The camera (its `x`, `y` are the world point at the viewport's top-left).
 */
export function centredCamera(centre: BenchPoint, zoom: number, viewport: CameraViewport): Camera {
  return {
    x: centre.x - viewport.widthPx / (2 * zoom),
    y: centre.y - viewport.heightPx / (2 * zoom),
    zoom,
    viewportWidthPx: viewport.widthPx,
    viewportHeightPx: viewport.heightPx,
    dpr: viewport.dpr,
  };
}

/**
 * The zoom sweep as camera moves for the engine's `animateCamera` (zoom geometric, centre
 * linear, on the engine's own frames): from {@link ZOOM_SWEEP}'s `fromZoom` in to `toZoom` over
 * half the duration, then back out over the other half, about one centre.
 *
 * @param centre - The world point the sweep zooms about.
 * @param viewport - The viewport.
 * @param durationMs - The whole sweep, ms.
 * @returns The camera to start from and the two legs.
 */
export function zoomSweepLegs(
  centre: BenchPoint,
  viewport: CameraViewport,
  durationMs: number,
): ZoomSweep {
  const start = centredCamera(centre, ZOOM_SWEEP.fromZoom, viewport);
  const inward = centredCamera(centre, ZOOM_SWEEP.toZoom, viewport);
  const half = durationMs / 2;
  return {
    start,
    legs: [
      { camera: inward, durationMs: half },
      { camera: start, durationMs: half },
    ],
  };
}
