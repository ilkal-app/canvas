/** The slowest presence rate, in Hz: below it remote cursors visibly lag. */
export const MIN_PRESENCE_RATE_HZ = 20;

/** The fastest presence rate, in Hz: above it twenty collaborators flood the relay for no gain. */
export const MAX_PRESENCE_RATE_HZ = 30;

/** The default presence rate, in Hz: one outbound update every 40 ms at most. */
export const DEFAULT_PRESENCE_RATE_HZ = 25;

/**
 * Turns a presence rate into the minimum spacing between two outbound updates.
 *
 * @param rateHz - Outbound updates per second, from {@link MIN_PRESENCE_RATE_HZ} to
 *   {@link MAX_PRESENCE_RATE_HZ}.
 * @returns The spacing, in ms.
 * @throws {RangeError} When `rateHz` is outside 20 to 30 Hz or not a number.
 */
export function presenceIntervalMs(rateHz: number): number {
  if (!(rateHz >= MIN_PRESENCE_RATE_HZ && rateHz <= MAX_PRESENCE_RATE_HZ)) {
    throw new RangeError(
      `A presence rate is ${String(MIN_PRESENCE_RATE_HZ)} to ${String(MAX_PRESENCE_RATE_HZ)} Hz; ` +
        `received ${String(rateHz)}.`,
    );
  }
  return 1000 / rateHz;
}

/** What the outbound throttle knows when a local change arrives. */
export interface OutboundThrottleState {
  /** When the last update went out, in ms; undefined before the first. */
  readonly lastSentAtMs: number | undefined;
  /** Whether a trailing flush is already scheduled. */
  readonly isFlushPending: boolean;
}

/**
 * What to do with a local change: send it now, schedule a trailing flush that sends the latest
 * state after `delayMs`, or nothing because a pending flush will carry it.
 */
export type OutboundDecision =
  | {
      /** Write the state to awareness now. */
      readonly kind: 'send-now';
    }
  | {
      /** Schedule one trailing flush. */
      readonly kind: 'flush-later';
      /** How long until the flush, in ms: the rest of the current interval. */
      readonly delayMs: number;
    }
  | {
      /** Do nothing: the pending flush will send the latest state. */
      readonly kind: 'already-pending';
    };

/**
 * Decides when a local presence change goes out: a leading-edge send when the interval since
 * the last send has passed, otherwise one trailing flush at the end of the interval, which
 * sends whatever the state is by then. So updates are never closer than `intervalMs` and the
 * last position always goes out.
 *
 * @param state - When the last update went out and whether a flush is pending.
 * @param nowMs - The current time, in ms.
 * @param intervalMs - The minimum spacing between updates, in ms (see {@link presenceIntervalMs}).
 * @returns The decision.
 */
export function decideOutbound(
  state: OutboundThrottleState,
  nowMs: number,
  intervalMs: number,
): OutboundDecision {
  if (state.isFlushPending) {
    return { kind: 'already-pending' };
  }
  if (state.lastSentAtMs === undefined || nowMs - state.lastSentAtMs >= intervalMs) {
    return { kind: 'send-now' };
  }
  return { kind: 'flush-later', delayMs: state.lastSentAtMs + intervalMs - nowMs };
}
