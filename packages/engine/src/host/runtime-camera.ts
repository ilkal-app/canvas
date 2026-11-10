import type { Camera } from '../camera/camera.js';

import { CameraAnimation, type CameraViewport } from './camera-animation.js';

/**
 * The engine runtime's camera and its animation: the camera the next
 * frame draws with, set outright or animated towards on the runtime's own frames, and resized
 * with the canvas. On the thread that renders.
 */
export class RuntimeCamera {
  private camera: Camera | undefined;
  private animation: CameraAnimation | undefined;
  private changeCount = 0;

  /**
   * Counts every set, animation and resize, so a frame can tell the camera changed under it.
   *
   * @returns The count so far.
   */
  get revision(): number {
    return this.changeCount;
  }

  /**
   * Whether an animation is running: the runtime keeps asking for frames.
   *
   * @returns True while animating.
   */
  get isAnimating(): boolean {
    return this.animation !== undefined;
  }

  /**
   * Draws with this camera from the next frame, stopping any animation.
   *
   * @param camera - The camera.
   */
  set(camera: Camera): void {
    this.changeCount += 1;
    this.animation = undefined;
    this.camera = camera;
  }

  /**
   * Animates from the current camera to `camera`; jumps when there is no current camera.
   *
   * @param camera - Where the camera ends.
   * @param durationMs - How long the move takes, ms.
   */
  animate(camera: Camera, durationMs: number): void {
    if (this.camera === undefined) {
      this.set(camera);
      return;
    }
    this.changeCount += 1;
    this.animation = new CameraAnimation(this.camera, camera, durationMs);
  }

  /**
   * Gives the camera the canvas's new viewport.
   *
   * @param widthPx - Drawing buffer width, device px.
   * @param heightPx - Drawing buffer height, device px.
   * @param dpr - Device pixels per CSS pixel.
   */
  resize(widthPx: number, heightPx: number, dpr: number): void {
    this.changeCount += 1;
    if (this.camera === undefined) return;
    this.camera = {
      ...this.camera,
      viewportWidthPx: widthPx / dpr,
      viewportHeightPx: heightPx / dpr,
      dpr,
    };
  }

  /** Stops the animation where it is: a frame threw. */
  stop(): void {
    this.animation = undefined;
  }

  /**
   * The camera at a frame's time, advancing the animation.
   *
   * @param timeMs - The frame's time, ms.
   * @returns The camera, or undefined before one was set.
   */
  at(timeMs: number): Camera | undefined {
    const { animation, camera } = this;
    if (animation === undefined || camera === undefined) return camera;
    const viewport: CameraViewport = camera;
    this.camera = animation.cameraAt(timeMs, viewport);
    if (animation.isFinished) this.animation = undefined;
    return this.camera;
  }
}
