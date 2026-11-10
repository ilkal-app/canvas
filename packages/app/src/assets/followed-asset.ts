import type { AssetRecord } from '@canvas/schema';

/** One followed asset. */
export interface Followed {
  /** Server-directed retry deadline; does not consume no-news attempts. */
  retryAt?: number;
  /** Its record as last read, or undefined while the board cannot read it. */
  record: AssetRecord | undefined;
  /** How many waits in a row have gone by without a new record. */
  attempt: number;
  /** Where its waits start in `FOLLOW_DELAYS_MS`: late for an asset never linked. */
  firstAttempt: number;
  /** Ends the open stream, while one is. */
  stream: AbortController | undefined;
  /** Cancels the wait before a stream is opened again, while one is. */
  cancelWait: (() => void) | undefined;
  /** Whether it waits for its poll (in the budget's queue) or its poll is under way. */
  isPolling: boolean;
  /** Whether it waits only for a free stream (its record is known), rather than backing off. */
  isWaitingForStream: boolean;
  /** Whether the follower gave up on it, until it is revived. */
  isGivenUp: boolean;
}
