import { AssetsHttpError } from './assets-responses.js';

/** Shared server-directed deadline for the read routes of one board adapter. */
export class ReadCooldown {
  private until = 0;
  /**
   * Creates an empty deadline.
   *
   * @param now - Clock in milliseconds.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Remaining wait before another read request may be sent.
   *
   * @returns The remaining wait in milliseconds.
   */
  get remainingMs(): number {
    return Math.max(0, this.until - this.now());
  }

  /**
   * Refuses an early request without spending network or server capacity.
   *
   * @throws {AssetsHttpError} While the shared deadline has not elapsed.
   */
  check(): void {
    const remaining = this.remainingMs;
    if (remaining > 0)
      throw new AssetsHttpError(429, 'rate-limited', 'The asset reads are waiting.', remaining);
  }

  /**
   * Advances the shared deadline from a server refusal.
   *
   * @param error - The HTTP error, if any.
   */
  observe(error: unknown): void {
    if (!(error instanceof AssetsHttpError) || error.status !== 429) return;
    const delay = Number.isFinite(error.retryAfterMs)
      ? Math.max(1000, error.retryAfterMs ?? 1000)
      : 1000;
    this.until = Math.max(this.until, this.now() + delay);
  }
}
