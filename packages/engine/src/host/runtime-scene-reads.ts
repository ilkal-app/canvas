import type { Camera } from '../camera/camera.js';
import type { SceneRenderer } from '../scene/scene-renderer.js';

import { PreviewReads } from './preview-reads.js';
import { ProjectionReads } from './scene-projection.js';

/** Candidate and certificate reads sharing a runtime's frame and failure lifetime. */
export class RuntimeSceneReads {
  readonly projections = new ProjectionReads();
  readonly previews = new PreviewReads();

  /**
   * Answers scene reads without accepting reentrant invalidation.
   *
   * @param renderer - Renderer that completed this frame.
   * @param camera - Camera actually drawn.
   * @param hasPendingChanges - Whether arrivals still await application.
   * @param isInvalid - Live check for destruction, arrivals or a replaced camera.
   */
  answer(
    renderer: SceneRenderer,
    camera: Camera | undefined,
    hasPendingChanges: boolean,
    isInvalid: () => boolean,
  ): void {
    this.projections.answer(renderer, camera, hasPendingChanges);
    this.previews.answer(renderer, camera, isInvalid);
  }

  /**
   * Rejects both kinds after a failed frame or destruction.
   *
   * @param error - The runtime failure.
   */
  reject(error: Error): void {
    this.projections.reject(error);
    this.previews.reject(error);
  }
}
