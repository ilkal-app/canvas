import { isSceneStamp, type SceneStamp } from './scene-certificate.js';

/**
 * Revisions mirrored and enqueued by the frame apply stage. Matches are usable only after a
 * successful render with empty runtime/renderer queues; invalidation never alters rendering.
 */
export class SceneRevisions {
  private applied: SceneStamp | undefined;
  private isInvalidated = false;
  /**
   * Records a batch mirrored and enqueued for the renderer.
   *
   * @param stamp - Its app-owned revision, absent for ordinary callers.
   */
  apply(stamp: SceneStamp | undefined): void {
    if (this.isInvalidated) return;
    if (
      !isSceneStamp(stamp) ||
      (this.applied === undefined
        ? stamp.sequence !== 0
        : stamp.session !== this.applied.session || stamp.sequence !== this.applied.sequence + 1)
    ) {
      this.invalidate();
      return;
    }
    this.applied = { ...stamp };
  }

  /**
   * Checks exact applied identity; receiving a queued revision is insufficient.
   *
   * @param stamp - The requested frame's revision.
   * @returns Whether the apply stage enqueued that revision; not independent proof of a drawn frame.
   */
  matches(stamp: SceneStamp): boolean {
    return (
      !this.isInvalidated &&
      this.applied?.session === stamp.session &&
      this.applied.sequence === stamp.sequence
    );
  }

  /** Permanently refuses certification after a frame failure or unsupported document stream. */
  invalidate(): void {
    this.isInvalidated = true;
  }
}
