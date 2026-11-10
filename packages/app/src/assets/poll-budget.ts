/** Schedules a callback; returns a function that cancels it. */
export type ScheduleTimer = (callback: () => void, delayMs: number) => () => void;

/**
 * The thread's own `setTimeout`, as a {@link ScheduleTimer}.
 *
 * @param callback - What to run.
 * @param delayMs - After how long, ms.
 * @returns Cancels it.
 */
export const DEFAULT_SCHEDULE: ScheduleTimer = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(handle);
  };
};

/**
 * How long the follower waits before each poll of an asset it cannot stream (the board not
 * linked to it: a collaborator's upload still going; or no stream free), or before opening a
 * stream that ended or failed again, ms: doubling from 1 s to five minutes. A wait that brings
 * a new record starts the asset's waits over.
 */
export const FOLLOW_DELAYS_MS: readonly number[] = [
  1000, 2000, 4000, 8000, 15_000, 30_000, 60_000, 120_000, 300_000,
];

/**
 * Where the waits of an asset the board was never linked to, and that this page is not
 * uploading, start in {@link FOLLOW_DELAYS_MS}: at 15 s (index 4), the slow rate, since most such
 * ids will never be linked (an abandoned upload, a hostile client's objects).
 */
export const UNLINKED_FIRST_ATTEMPT = 4;

/**
 * How many waits in a row without a new record the follower allows an asset off screen before it
 * gives up on it, until it comes on screen, its object changes, a record for it arrives from
 * elsewhere, or the page reloads: about 14 minutes of quick then slow polls from the first delay,
 * about 34 minutes from {@link UNLINKED_FIRST_ATTEMPT} (15 + 30 + 60 + 120 s, then 300 s six
 * times). An asset on screen is never given up on.
 */
export const MAX_FOLLOW_ATTEMPTS = 10;

/**
 * Maximum per-asset eligibility delay on screen, ms. Shared queue capacity takes precedence:
 * many visible assets can wait longer for dispatch. News resets waits; visibility and revive
 * restart eligibility without clearing the shared aggregate backoff or server cooldown.
 */
export const ON_SCREEN_MAX_DELAY_MS = 60_000;

/** The most record requests (polls) a board's follower sends per {@link POLL_INTERVAL_MS}. */
export const POLL_BUDGET = 4;

/** The interval the {@link POLL_BUDGET} is counted over, ms. */
export const POLL_INTERVAL_MS = 5000;

/**
 * The most record requests a viewer's follower sends a minute, whatever the board holds:
 * `POLL_BUDGET × 60 000 / POLL_INTERVAL_MS` = 48 (480 in ten minutes). A board naming 5,000
 * assets no one will ever link (a hostile or old client's objects) drew about 20,000 a minute
 * (5,000 every 15 s) before the budget. With it, the assets on screen take the whole budget in
 * turn while due. Every four unchanged completions increases the aggregate interval through
 * 5, 10, 20, 40 and 60 seconds, giving at most four polls per minute after sixteen no-news
 * completions. Fresh news resets that backoff. Off-screen assets eventually stop until revived;
 * visible assets keep retrying. Server capacity can delay every dispatch further.
 */
export const WORST_CASE_POLLS_PER_MINUTE = (POLL_BUDGET * 60_000) / POLL_INTERVAL_MS;

/** One queued poll. */
interface QueuedPoll<Item> {
  /** What the poll is for. */
  readonly item: Item;
  /** When it may go, on the budget's clock, ms. */
  readonly dueAt: number;
}

/**
 * The follower's poll budget (fix round 1): polls queue with the time they may go, and at
 * most `budget` of those due go every `intervalMs`, the preferred keys (visible images) first,
 * then the longest due, so every asset has its turn (round robin by due time). Nothing goes
 * while paused (the page hidden). One timer at a time, set for the next run. Pure bookkeeping
 * apart from the timer; the caller does the requests.
 */
export class PollBudget<Item> {
  private readonly queue = new Map<string, QueuedPoll<Item>>();
  private preferred: ReadonlySet<string> = new Set();
  private isPaused = false;
  private isClosed = false;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private runAt: number | undefined;
  private cancelRun: (() => void) | undefined;
  private noNews = 0;
  private epoch = 0;

  /**
   * An empty budget.
   *
   * @param schedule - Sets its timer.
   * @param now - Its clock, ms.
   * @param run - Sends one poll.
   * @param budget - The most polls per interval; {@link POLL_BUDGET} by default.
   * @param intervalMs - The interval, ms; {@link POLL_INTERVAL_MS} by default.
   * @param capacityWaitMs - Shared server cooldown remaining, checked before every dispatch.
   */
  constructor(
    private readonly schedule: ScheduleTimer,
    private readonly now: () => number,
    private readonly run: (key: string, item: Item) => void,
    private readonly budget = POLL_BUDGET,
    private readonly intervalMs = POLL_INTERVAL_MS,
    private readonly capacityWaitMs: () => number = () => 0,
  ) {}

  /**
   * How many polls wait.
   *
   * @returns The count.
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Current news generation; capture when a request starts.
   *
   * @returns The generation.
   */
  get generation(): number {
    return this.epoch;
  }

  /**
   * Counts completed unchanged reads; fresh news restarts the aggregate backoff.
   *
   * @param hasNews - Whether a record changed.
   * @param generation - Generation captured before the request, for unchanged completions.
   */
  recordResult(hasNews: boolean, generation = this.epoch): void {
    const before = this.waitInterval();
    if (hasNews) {
      this.epoch += 1;
      this.noNews = 0;
    } else if (generation === this.epoch) {
      this.noNews = Math.min(16, this.noNews + 1);
    }
    if (before !== this.waitInterval()) {
      this.cancel();
      this.requestEarliest();
    }
  }

  /**
   * Aggregate interval after each four unchanged completions.
   *
   * @returns Milliseconds.
   */
  private waitInterval(): number {
    return this.intervalMs * ([1, 2, 4, 8, 12][Math.floor(this.noNews / 4)] ?? 12);
  }

  /**
   * Remaining shared capacity wait, with invalid values refusing briefly.
   *
   * @returns Milliseconds.
   */
  private capacityWait(): number {
    const wait = this.capacityWaitMs();
    return Number.isFinite(wait)
      ? Math.min(2_147_483_647, Math.max(0, Math.ceil(wait)))
      : this.intervalMs;
  }

  /**
   * Queues a poll (replacing the key's queued one).
   *
   * @param key - What it is for.
   * @param item - What `run` gets.
   * @param dueAt - When it may go, ms.
   */
  enqueue(key: string, item: Item, dueAt: number): void {
    if (this.isClosed) return;
    this.queue.set(key, { item, dueAt });
    this.request(dueAt);
  }

  /**
   * Drops a key's queued poll.
   *
   * @param key - The key.
   * @returns Whether one was queued.
   */
  remove(key: string): boolean {
    const isRemoved = this.queue.delete(key);
    if (this.queue.size === 0) this.cancel();
    return isRemoved;
  }

  /**
   * The keys whose polls go first.
   *
   * @param keys - The keys.
   */
  setPreferred(keys: ReadonlySet<string>): void {
    this.preferred = keys;
  }

  /**
   * Pauses the polls, or resumes them.
   *
   * @param isPaused - Whether to pause.
   */
  setPaused(isPaused: boolean): void {
    if (isPaused === this.isPaused) return;
    this.isPaused = isPaused;
    if (isPaused) this.cancel();
    else this.requestEarliest();
  }

  /** Drops every poll and the timer, for good. */
  close(): void {
    this.isClosed = true;
    this.cancel();
    this.queue.clear();
  }

  /**
   * Sets the timer for a poll due at a time, unless one is set no later than it may go.
   *
   * @param dueAt - When the poll may go, ms.
   */
  private request(dueAt: number): void {
    if (this.isPaused || this.isClosed) return;
    const at = Math.max(
      dueAt,
      this.lastRunAt + this.waitInterval(),
      this.now() + this.capacityWait(),
    );
    if (this.runAt !== undefined && this.runAt <= at) return;
    this.cancel();
    this.runAt = at;
    this.cancelRun = this.schedule(
      () => {
        this.runAt = undefined;
        this.cancelRun = undefined;
        this.runDue();
      },
      Math.max(0, at - this.now()),
    );
  }

  /** Sets the timer for the earliest queued poll. */
  private requestEarliest(): void {
    let earliest = Number.POSITIVE_INFINITY;
    for (const { dueAt } of this.queue.values()) earliest = Math.min(earliest, dueAt);
    if (earliest !== Number.POSITIVE_INFINITY) this.request(earliest);
  }

  /** Sends the budget's worth of due polls, preferred first, then the longest due. */
  private runDue(): void {
    if (this.isPaused || this.isClosed) return;
    const now = this.now();
    if (this.capacityWait() > 0) {
      this.requestEarliest();
      return;
    }
    const chosen: [string, QueuedPoll<Item>][] = [];
    for (const entry of this.queue) {
      if (entry[1].dueAt > now) continue;
      chosen.push(entry);
      if (chosen.length > this.budget) {
        chosen.sort(this.compare);
        chosen.pop();
      }
    }
    chosen.sort(this.compare);
    for (const [key, { item }] of chosen) {
      if (this.capacityWait() > 0) break;
      this.lastRunAt = now;
      this.queue.delete(key);
      this.run(key, item);
    }
    this.requestEarliest();
  }

  /**
   * Orders due polls: preferred keys first, then by due time.
   *
   * @param a - One poll.
   * @param b - The other.
   * @returns Negative when `a` goes first.
   */
  private readonly compare = (a: [string, QueuedPoll<Item>], b: [string, QueuedPoll<Item>]) => {
    const rank = Number(!this.preferred.has(a[0])) - Number(!this.preferred.has(b[0]));
    return rank !== 0 ? rank : a[1].dueAt - b[1].dueAt;
  };

  /** Cancels the timer. */
  private cancel(): void {
    this.cancelRun?.();
    this.cancelRun = undefined;
    this.runAt = undefined;
  }
}
