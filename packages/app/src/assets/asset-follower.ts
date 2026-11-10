import type { AssetId, AssetRecord } from '@canvas/schema';

import { MAX_EVENT_STREAMS, type AssetFollowerOptions } from './asset-follower-options.js';
import { AssetsHttpError } from './assets-responses.js';
import type { Followed } from './followed-asset.js';
import {
  DEFAULT_SCHEDULE,
  FOLLOW_DELAYS_MS,
  MAX_FOLLOW_ATTEMPTS,
  ON_SCREEN_MAX_DELAY_MS,
  PollBudget,
  UNLINKED_FIRST_ATTEMPT,
  type ScheduleTimer,
} from './poll-budget.js';
import { isNews, isSettledRecord } from './record-news.js';

export { MAX_EVENT_STREAMS } from './asset-follower-options.js';
export type { AssetFollowerOptions, FollowerHttp } from './asset-follower-options.js';

/**
 * Follows unsettled assets through at most `MAX_EVENT_STREAMS` streams and a shared poll queue.
 * Visible eligibility backs off to 60 seconds; offscreen waits reach five minutes then stop
 * after `MAX_FOLLOW_ATTEMPTS`. News resets waits; visibility and revive restart eligibility.
 * Shared aggregate backoff and server cooldown take precedence over per-asset eligibility.
 * Visible IDs take priority; hidden pages pause, settled assets stop, and `close` ends all work.
 */
export class AssetFollower {
  private readonly options: AssetFollowerOptions;
  private readonly schedule: ScheduleTimer;
  private readonly now: () => number;
  private readonly maxStreams: number;
  private readonly followed = new Map<AssetId, Followed>();
  private readonly budget: PollBudget<Followed>;
  private visible: ReadonlySet<AssetId> = new Set();
  private openStreams = 0;
  private isClosed = false;

  /**
   * Starts following nothing.
   *
   * @param options - The client, the record callback, the timer, the clock and the stream cap.
   */
  constructor(options: AssetFollowerOptions) {
    this.options = options;
    this.schedule = options.schedule ?? DEFAULT_SCHEDULE;
    this.now = options.now ?? Date.now;
    this.maxStreams = options.maxStreams ?? MAX_EVENT_STREAMS;
    this.budget = new PollBudget<Followed>(
      this.schedule,
      this.now,
      (assetId, entry) => {
        this.poll(assetId as AssetId, entry);
      },
      undefined,
      undefined,
      () => this.options.http().readWaitMs ?? 0,
    );
  }

  /**
   * Follows an asset until its record settles; nothing for one settled. An asset this page
   * uploads is followed at the quick rate, even one followed already at the slow one, and one
   * given up on is followed again.
   *
   * @param assetId - The asset.
   * @param record - Its record as known, if any.
   * @param isOwnUpload - Whether this page uploaded it (its upload verified).
   */
  follow(assetId: AssetId, record: AssetRecord | undefined, isOwnUpload = false): void {
    if (this.isClosed) return;
    const known = this.followed.get(assetId);
    if (known !== undefined) {
      if (isOwnUpload) known.firstAttempt = 0;
      if (isOwnUpload || known.isGivenUp) this.restart(assetId, known);
      return;
    }
    if (record !== undefined && isSettledRecord(record)) return;
    const entry: Followed = {
      record,
      attempt: 0,
      firstAttempt: record === undefined && !isOwnUpload ? UNLINKED_FIRST_ATTEMPT : 0,
      stream: undefined,
      cancelWait: undefined,
      isPolling: false,
      isWaitingForStream: false,
      isGivenUp: false,
    };
    this.followed.set(assetId, entry);
    this.advance(assetId, entry);
  }

  /**
   * Tells the follower of a record read elsewhere (a describe, a completion), which may settle
   * the asset, let it stream or follow it again after the follower gave up on it.
   *
   * @param record - The record.
   */
  learn(record: AssetRecord): void {
    const entry = this.followed.get(record.id);
    if (entry === undefined) return;
    if (isNews(entry.record, record)) this.budget.recordResult(true);
    entry.record = record;
    entry.firstAttempt = 0;
    if (isSettledRecord(record)) this.unfollow(record.id);
    else if (entry.stream === undefined) this.restart(record.id, entry);
  }

  /**
   * Restarts visible eligibility or an asset given up on when an object using it changes.
   * Shared no-news backoff and server capacity remain in force.
   *
   * @param assetId - The asset.
   */
  revive(assetId: AssetId): void {
    const entry = this.followed.get(assetId);
    if (entry !== undefined && (entry.isGivenUp || this.visible.has(assetId))) {
      this.restart(assetId, entry, this.visible.has(assetId));
    }
  }

  /**
   * Which assets are on screen: their polls go first, become eligible within the visible cap and
   * never give up; one that came on screen since the last call is polled at once (within the
   * budget), even one the follower gave up on. O(assets on screen).
   *
   * @param assetIds - The assets of the images on screen still drawn from their placeholder.
   */
  setVisible(assetIds: ReadonlySet<AssetId>): void {
    const before = this.visible;
    this.visible = assetIds;
    this.budget.setPreferred(assetIds);
    for (const assetId of assetIds) {
      const entry = before.has(assetId) ? undefined : this.followed.get(assetId);
      if (entry !== undefined && entry.stream === undefined) this.restart(assetId, entry, true);
    }
  }

  /**
   * Pauses the polls while the page is hidden, and resumes them once it shows again. Open
   * streams stay open: they cost no request.
   *
   * @param isHidden - Whether the page is hidden.
   */
  setHidden(isHidden: boolean): void {
    this.budget.setPaused(isHidden);
  }

  /**
   * Stops following an asset: its stream ends and its waits are cancelled.
   *
   * @param assetId - The asset.
   */
  unfollow(assetId: AssetId): void {
    const entry = this.followed.get(assetId);
    if (entry === undefined) return;
    this.followed.delete(assetId);
    this.budget.remove(assetId);
    entry.cancelWait?.();
    entry.stream?.abort();
  }

  /** Stops following everything, for good. */
  close(): void {
    this.isClosed = true;
    for (const assetId of [...this.followed.keys()]) this.unfollow(assetId);
    this.budget.close();
  }

  /**
   * Starts an asset's waits over, unless its stream is open.
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   * @param isAtOnce - Whether its next poll goes at once rather than after its first wait (it
   *   came on screen).
   */
  private restart(assetId: AssetId, entry: Followed, isAtOnce = false): void {
    entry.isGivenUp = false;
    entry.attempt = 0;
    if (entry.stream !== undefined) return;
    entry.cancelWait?.();
    entry.cancelWait = undefined;
    this.budget.remove(assetId);
    entry.isPolling = false;
    this.advance(assetId, entry, isAtOnce);
  }

  /**
   * Takes an asset's next step: a stream when the board can read it and one is free, else a
   * poll after the next wait (or at once).
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   * @param isAtOnce - Whether the poll goes at once, without a wait.
   */
  private advance(assetId: AssetId, entry: Followed, isAtOnce = false): void {
    if (entry.isGivenUp) return;
    if (entry.record !== undefined && this.openStreams < this.maxStreams) {
      this.openStream(assetId, entry);
      return;
    }
    const delay = isAtOnce ? 0 : this.nextDelay(assetId, entry);
    if (delay !== undefined) this.queuePoll(assetId, entry, this.now() + delay);
  }

  /**
   * Queues the asset's poll in the budget.
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   * @param dueAt - When it may go, ms.
   */
  private queuePoll(assetId: AssetId, entry: Followed, dueAt: number): void {
    entry.isWaitingForStream = entry.record !== undefined;
    entry.isPolling = true;
    this.budget.enqueue(assetId, entry, dueAt);
  }

  /**
   * The asset's next wait, each longer than the last without news, at most
   * `ON_SCREEN_MAX_DELAY_MS` on screen; none when the follower gives up on it (off screen only).
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   * @returns The wait, ms, or undefined after `MAX_FOLLOW_ATTEMPTS` waits without news off screen.
   */
  private nextDelay(assetId: AssetId, entry: Followed): number | undefined {
    const remaining = Math.max(
      (entry.retryAt ?? 0) - this.now(),
      this.options.http().readWaitMs ?? 0,
    );
    if (remaining > 0) return Math.min(remaining, 2_147_483_647);
    const isOnScreen = this.visible.has(assetId);
    if (entry.attempt >= MAX_FOLLOW_ATTEMPTS && !isOnScreen) {
      entry.isGivenUp = true;
      return undefined;
    }
    const index = Math.min(entry.firstAttempt + entry.attempt, FOLLOW_DELAYS_MS.length - 1);
    entry.attempt += 1;
    const delay = FOLLOW_DELAYS_MS[index] ?? 0;
    return isOnScreen ? Math.min(delay, ON_SCREEN_MAX_DELAY_MS) : delay;
  }

  /**
   * Reads the record once (the budget chose it); news starts the waits over.
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   */
  private poll(assetId: AssetId, entry: Followed): void {
    const generation = this.budget.generation;
    this.options
      .http()
      .record(assetId)
      .then(
        (record) => {
          if (this.followed.get(assetId) !== entry) return;
          if (!isNews(entry.record, record)) this.budget.recordResult(false, generation);
          this.receive(assetId, entry, record);
        },
        (error: unknown) => {
          if (this.followed.get(assetId) !== entry) return;
          if (error instanceof AssetsHttpError && error.status === 429)
            entry.retryAt = this.now() + Math.max(1000, error.retryAfterMs ?? 1000);
          if (error instanceof AssetsHttpError && error.status === 404) {
            this.budget.recordResult(false, generation);
          }
          this.refused(error);
        },
      )
      .finally(() => {
        if (this.followed.get(assetId) !== entry || !entry.isPolling) return;
        entry.isPolling = false;
        if (entry.stream === undefined && entry.cancelWait === undefined) {
          this.advance(assetId, entry);
        }
      });
  }

  /**
   * Opens the asset's event stream; when it ends before the asset settles (a restart, a network
   * failure), the asset waits and streams again (or polls, once the board cannot read it).
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   */
  private openStream(assetId: AssetId, entry: Followed): void {
    const stream = new AbortController();
    entry.stream = stream;
    entry.isWaitingForStream = false;
    this.openStreams += 1;
    this.options
      .http()
      .events(
        assetId,
        (record) => {
          this.receive(assetId, entry, record);
        },
        stream.signal,
      )
      .catch((error: unknown) => {
        if (error instanceof AssetsHttpError && error.status === 404) entry.record = undefined;
        if (error instanceof AssetsHttpError && error.status === 429)
          entry.retryAt = this.now() + Math.max(1000, error.retryAfterMs ?? 1000);
        this.refused(error);
      })
      .finally(() => {
        this.openStreams -= 1;
        entry.stream = undefined;
        if (this.followed.get(assetId) === entry) this.waitThenStream(assetId, entry);
        this.wakeWaiting();
      });
  }

  /**
   * Waits the asset's next wait after its stream ended, then streams again, or queues a poll due
   * at once when no stream is free or the board cannot read it; gives up after too many.
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   */
  private waitThenStream(assetId: AssetId, entry: Followed): void {
    const delay = this.nextDelay(assetId, entry);
    if (delay === undefined) return;
    entry.cancelWait = this.schedule(() => {
      entry.cancelWait = undefined;
      if (entry.record !== undefined && this.openStreams < this.maxStreams) {
        this.openStream(assetId, entry);
      } else {
        this.queuePoll(assetId, entry, this.now());
      }
    }, delay);
  }

  /**
   * Handles a record read by a poll or a stream.
   *
   * @param assetId - The asset.
   * @param entry - Its state.
   * @param record - The record.
   */
  private receive(assetId: AssetId, entry: Followed, record: AssetRecord): void {
    if (this.followed.get(assetId) !== entry) return;
    entry.retryAt = 0;
    if (isNews(entry.record, record)) {
      entry.attempt = 0;
      this.budget.recordResult(true);
    }
    entry.record = record;
    entry.firstAttempt = 0;
    this.options.onRecord(record);
    if (isSettledRecord(record)) this.unfollow(assetId);
  }

  /** Lets the assets waiting only for a stream take the ones that freed. */
  private wakeWaiting(): void {
    if ((this.options.http().readWaitMs ?? 0) > 0) return;
    for (const [assetId, entry] of this.followed) {
      if ((entry.retryAt ?? 0) > this.now()) continue;
      if (this.openStreams >= this.maxStreams) return;
      if (!entry.isWaitingForStream || entry.isGivenUp) continue;
      if (!this.budget.remove(assetId)) continue;
      entry.isPolling = false;
      this.openStream(assetId, entry);
    }
  }

  /**
   * Asks the adapter for a fresh token when the service refused this one (`401`).
   *
   * @param error - What a request failed with.
   */
  private refused(error: unknown): void {
    if (error instanceof AssetsHttpError && error.status === 401) this.options.onUnauthorised?.();
  }
}
