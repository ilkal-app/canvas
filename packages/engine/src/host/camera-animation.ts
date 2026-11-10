import type { Camera } from '../camera/camera.js';

/** The part of a camera that belongs to the canvas, not the view: its size and pixel ratio. */
export type CameraViewport = Pick<Camera, 'viewportWidthPx' | 'viewportHeightPx' | 'dpr'>;

function centreOf(camera: Camera): { readonly x: number; readonly y: number } {
  return {
    x: camera.x + camera.viewportWidthPx / 2 / camera.zoom,
    y: camera.y + camera.viewportHeightPx / 2 / camera.zoom,
  };
}

/**
 * The camera part of the way from one camera to another: the zoom changes geometrically (each
 * equal step scales the view by the same factor, so a zoom across 0.05×–32× does not rush through
 * the far-out end) and the world point at the viewport's centre moves in a straight line. Pure.
 *
 * @param from - The camera at progress 0.
 * @param to - The camera at progress 1.
 * @param progress - How far along, clamped to [0, 1].
 * @param viewport - The canvas size and pixel ratio of the result, which a resize may have
 *   changed since the animation began.
 * @returns The camera at that progress.
 */
export function interpolateCamera(
  from: Camera,
  to: Camera,
  progress: number,
  viewport: CameraViewport,
): Camera {
  const t = Math.min(1, Math.max(0, progress));
  const zoom = t === 1 ? to.zoom : from.zoom * (to.zoom / from.zoom) ** t;
  const [start, end] = [centreOf(from), centreOf(to)];
  const centreX = start.x + (end.x - start.x) * t;
  const centreY = start.y + (end.y - start.y) * t;
  return {
    x: centreX - viewport.viewportWidthPx / 2 / zoom,
    y: centreY - viewport.viewportHeightPx / 2 / zoom,
    zoom,
    // Named, not spread: a whole camera may be passed as the viewport.
    viewportWidthPx: viewport.viewportWidthPx,
    viewportHeightPx: viewport.viewportHeightPx,
    dpr: viewport.dpr,
  };
}

/**
 * A camera move animated by the engine's own frame loop, so it keeps moving however busy the
 * main thread is (zoom to fit and to selection). Time starts at the first frame that asks for
 * a camera, in that frame's clock.
 */
export class CameraAnimation {
  private readonly from: Camera;
  private readonly to: Camera;
  private readonly durationMs: number;
  private startMs: number | undefined;
  private hasEnded = false;

  /**
   * Creates an animation that has not started.
   *
   * @param from - The camera it starts from.
   * @param to - The camera it ends at.
   * @param durationMs - How long it lasts, ms; 0 or less jumps to `to` on the first frame.
   */
  constructor(from: Camera, to: Camera, durationMs: number) {
    this.from = from;
    this.to = to;
    this.durationMs = durationMs;
  }

  /**
   * Whether a frame has reached the end.
   *
   * @returns `true` once `cameraAt` has returned the final camera.
   */
  get isFinished(): boolean {
    return this.hasEnded;
  }

  /**
   * The camera for a frame.
   *
   * @param timeMs - The frame's time, ms; the first call starts the animation.
   * @param viewport - The canvas's current size and pixel ratio.
   * @returns The camera to draw the frame with.
   */
  cameraAt(timeMs: number, viewport: CameraViewport): Camera {
    this.startMs ??= timeMs;
    const progress = this.durationMs > 0 ? (timeMs - this.startMs) / this.durationMs : 1;
    if (progress >= 1) this.hasEnded = true;
    return interpolateCamera(this.from, this.to, progress, viewport);
  }
}
