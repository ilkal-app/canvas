/** The wait before the first reconnection attempt, in ms. */
export const RECONNECT_BASE_DELAY_MS = 250;

/** The longest wait between reconnection attempts, in ms. */
export const RECONNECT_MAX_DELAY_MS = 10_000;

/**
 * The largest share of a wait that jitter removes: a jittered wait is between half and all of
 * the exponential wait, so clients that lost the same relay at once spread their attempts
 * without any of them retrying at once.
 */
export const RECONNECT_JITTER_RATIO = 0.5;

/** How reconnection attempts are spaced: exponential backoff with a cap and jitter. */
export interface ReconnectBackoff {
  /** The wait before the first attempt, in ms; positive. */
  readonly baseDelayMs: number;
  /** The longest wait, in ms; at least `baseDelayMs`. */
  readonly maxDelayMs: number;
  /** The largest share of a wait jitter removes, 0 (none) to 1. */
  readonly jitterRatio: number;
}

/**
 * The client's default backoff: {@link RECONNECT_BASE_DELAY_MS}, doubling up to
 * {@link RECONNECT_MAX_DELAY_MS}, with {@link RECONNECT_JITTER_RATIO}.
 */
export const DEFAULT_RECONNECT_BACKOFF: ReconnectBackoff = Object.freeze({
  baseDelayMs: RECONNECT_BASE_DELAY_MS,
  maxDelayMs: RECONNECT_MAX_DELAY_MS,
  jitterRatio: RECONNECT_JITTER_RATIO,
});

/**
 * Checks a backoff's fields.
 *
 * @param backoff - The backoff.
 * @throws {RangeError} When a delay is not positive and finite, the cap is below the base, or
 *   the jitter ratio is outside [0, 1].
 */
function checkBackoff(backoff: ReconnectBackoff): void {
  const { baseDelayMs, maxDelayMs, jitterRatio } = backoff;
  const isValid =
    Number.isFinite(baseDelayMs) &&
    baseDelayMs > 0 &&
    Number.isFinite(maxDelayMs) &&
    maxDelayMs >= baseDelayMs &&
    jitterRatio >= 0 &&
    jitterRatio <= 1;
  if (!isValid) {
    throw new RangeError(
      'A reconnect backoff has a positive base delay, a cap at least the base and a jitter ' +
        `ratio from 0 to 1; received ${JSON.stringify(backoff)}.`,
    );
  }
}

/**
 * Computes how long the client waits before a reconnection attempt after losing the relay: the
 * base delay, doubled on every further attempt, never more than the cap, then shortened by up
 * to the jitter ratio in proportion to `randomValue`. Edits made meanwhile stay in the store
 * and the offline cache and reach the relay by state-vector exchange on reconnection.
 *
 * @param attempt - The zero-based number of the attempt about to be made.
 * @param backoff - The spacing; default {@link DEFAULT_RECONNECT_BACKOFF}.
 * @param randomValue - A uniform random number in [0, 1); 0 (the default) means no jitter.
 * @returns The wait before that attempt, in ms.
 * @throws {RangeError} When `attempt` is not a non-negative integer, `randomValue` is outside
 *   [0, 1), or the backoff is malformed.
 */
export function computeReconnectDelay(
  attempt: number,
  backoff: ReconnectBackoff = DEFAULT_RECONNECT_BACKOFF,
  randomValue = 0,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(
      `A reconnection attempt is a non-negative integer; received ${String(attempt)}.`,
    );
  }
  if (!(randomValue >= 0 && randomValue < 1)) {
    throw new RangeError(`A random value is in [0, 1); received ${String(randomValue)}.`);
  }
  checkBackoff(backoff);
  const cappedMs = Math.min(backoff.maxDelayMs, backoff.baseDelayMs * 2 ** attempt);
  return cappedMs * (1 - backoff.jitterRatio * randomValue);
}
