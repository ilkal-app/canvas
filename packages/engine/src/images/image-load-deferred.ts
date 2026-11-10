/** Capacity wait from an asset adapter, distinct from a failed fetch or decode. */
export class ImageLoadDeferredError extends Error {
  /** Remaining wait chunk in milliseconds, bounded to the platform timer range. */
  readonly retryAfterMs: number;
  /**
   * Defers a load without spending its ordinary failure retry budget.
   *
   * @param retryAfterMs - Remaining wait chunk; the adapter rechecks any longer server deadline.
   * @throws {RangeError} When the delay cannot be represented by a timer.
   */
  constructor(retryAfterMs: number) {
    super('The image source asked this load to wait.');
    this.name = 'ImageLoadDeferredError';
    if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 2_147_483_647)
      throw new RangeError('Image deferral delay is outside the timer range.');
    this.retryAfterMs = retryAfterMs;
  }
}
