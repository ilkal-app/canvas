/**
 * The waits before each retry of a failed image load or description, ms: four retries, doubling,
 * about 7.5 s in all. A failure right after an upload is expected: the assets service links an
 * asset to its board only once the upload verifies, and until then a board's read of it is a
 * 404 like an unknown asset's (the assets service's rule for who can read an asset).
 */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000];

/**
 * Starts a one-shot timer: `callback` runs once after `delayMs`.
 *
 * @param callback - What to run.
 * @param delayMs - The wait, ms.
 * @returns Stops the timer before it runs, where the timer can be stopped.
 */
export type RetryTimer = (callback: () => void, delayMs: number) => (() => void) | undefined;

/** The global scope's timer, where there is one (a window, a worker, Node). */
const timerScope = globalThis as {
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
};

/**
 * The thread's own `setTimeout`, stopped by `clearTimeout`; nothing is ever retried where there
 * is none.
 *
 * @param callback - What to run.
 * @param delayMs - The wait, ms.
 * @returns Stops the timer.
 */
export const DEFAULT_RETRY_TIMER: RetryTimer = (callback, delayMs) => {
  const handle = timerScope.setTimeout?.(callback, delayMs);
  return () => {
    timerScope.clearTimeout?.(handle);
  };
};

/** One key's failures so far. */
interface Failure {
  attempts: number;
  isWaiting: boolean;
  /** Stops its wait's timer, while it waits. */
  stop: (() => void) | undefined;
}

/**
 * Retries with backoff for failed loads, by key (an image never blanks,
 * and a missing level must not cost a request per frame). A key that failed may not be tried
 * again until its wait is over; the schedule then calls back so the caller can plan again, and
 * after the last wait it gives up and the key is never tried again (the image keeps its
 * placeholder or the level it has) until the caller forgets the failure, typically because the
 * asset's description changed. On the thread that renders.
 */
export class RetrySchedule<K> {
  private readonly failures = new Map<K, Failure>();

  /**
   * Creates an empty schedule.
   *
   * @param timer - Starts the waits. Default the thread's `setTimeout`.
   * @param delaysMs - The wait before each retry, ms. Default {@link RETRY_DELAYS_MS}.
   */
  constructor(
    private readonly timer: RetryTimer = DEFAULT_RETRY_TIMER,
    private readonly delaysMs: readonly number[] = RETRY_DELAYS_MS,
  ) {}

  /**
   * Whether a key may be tried now: it never failed, or its wait is over and retries are left.
   *
   * @param key - The key.
   * @returns True when a load may start.
   */
  mayTry(key: K): boolean {
    const failure = this.failures.get(key);
    return (
      failure === undefined || (!failure.isWaiting && failure.attempts <= this.delaysMs.length)
    );
  }

  /**
   * Records a failure and, while retries are left, starts the wait before the next.
   *
   * @param key - The key that failed.
   * @param onDue - Called once the wait is over, unless the failure was forgotten meanwhile.
   * @returns True when it will be retried; false when the schedule has given up on it.
   */
  fail(key: K, onDue: () => void): boolean {
    const failure = this.failures.get(key) ?? { attempts: 0, isWaiting: false, stop: undefined };
    failure.attempts += 1;
    this.failures.set(key, failure);
    const delayMs = this.delaysMs[failure.attempts - 1];
    if (delayMs === undefined) return false;
    failure.isWaiting = true;
    failure.stop = this.timer(() => {
      failure.stop = undefined;
      if (this.failures.get(key) !== failure) return;
      failure.isWaiting = false;
      onDue();
    }, delayMs);
    return true;
  }

  /**
   * Waits for server-directed capacity without consuming or resetting failure attempts.
   *
   * @param key - The deferred load.
   * @param delayMs - Non-negative finite wait, in milliseconds.
   * @param onDue - Asks the owner to plan again when capacity may be available.
   * @returns False when ordinary failures already exhausted this key's retry budget.
   * @throws {RangeError} When the delay cannot be scheduled safely.
   */
  defer(key: K, delayMs: number, onDue: () => void): boolean {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2_147_483_647)
      throw new RangeError('Image deferral delay is outside the timer range.');
    const previous = this.failures.get(key);
    if ((previous?.attempts ?? 0) > this.delaysMs.length) return false;
    previous?.stop?.();
    const failure: Failure = {
      attempts: previous?.attempts ?? 0,
      isWaiting: true,
      stop: undefined,
    };
    this.failures.set(key, failure);
    failure.stop = this.timer(() => {
      failure.stop = undefined;
      if (this.failures.get(key) !== failure) return;
      failure.isWaiting = false;
      onDue();
    }, delayMs);
    return true;
  }

  /**
   * Forgets a key's failures: it loaded after all.
   *
   * @param key - The key.
   */
  succeed(key: K): void {
    this.forget(key);
  }

  /**
   * Forgets the failures of every key a predicate picks, so they may be tried at once.
   *
   * @param predicate - Picks the keys.
   */
  forgetWhere(predicate: (key: K) => boolean): void {
    for (const key of [...this.failures.keys()]) {
      if (predicate(key)) this.forget(key);
    }
  }

  /**
   * Stops every wait and forgets every failure: its owner is destroyed, and no callback may run
   * after (none asks the destroyed owner for a frame).
   */
  stopAll(): void {
    for (const key of [...this.failures.keys()]) this.forget(key);
  }

  /**
   * Forgets a key's failures, stopping its wait's timer.
   *
   * @param key - The key.
   */
  private forget(key: K): void {
    this.failures.get(key)?.stop?.();
    this.failures.delete(key);
  }
}
