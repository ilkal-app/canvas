import type { AssetId, AssetRecord } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';

/**
 * The most record reads (the engine's descriptions, signed-URL refreshes, an upload's first read)
 * a board's adapter has in flight at once (fix round 2): the engine describes every image
 * of the board once at load, and the HTTP client had no cap, so a board of 5,000 images sent
 * 5,000 requests at once. Polls are paced apart, by the follower's budget.
 */
export const MAX_RECORD_READS = 12;

/** Bounds a shared request, including its response body, so hung reads cannot fill every slot. */
const RECORD_READ_TIMEOUT_MS = 30_000;

/** One caller waiting for a queued read. */
interface Waiter {
  readonly resolve: (record: AssetRecord) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * The first id of a set that has a queued read, looking through the smaller of the two.
 *
 * @param preferred - The ids to prefer.
 * @param queued - The queued reads.
 * @returns The id, or undefined when none is queued.
 */
function firstQueuedIn(
  preferred: ReadonlySet<AssetId>,
  queued: ReadonlyMap<AssetId, unknown>,
): AssetId | undefined {
  if (preferred.size <= queued.size) {
    for (const assetId of preferred) if (queued.has(assetId)) return assetId;
    return undefined;
  }
  for (const assetId of queued.keys()) if (preferred.has(assetId)) return assetId;
  return undefined;
}

/**
 * A board's record reads, at most {@link MAX_RECORD_READS} in flight (fix round 2): the
 * rest queue, the assets of images on screen first, then those near the view or ahead of the
 * pan (the texture manager's padded and prefetch regions, which the engine reports), then the
 * rest of the board in the order asked for, whenever no read of those two is waiting. A burst of
 * reads asked for together (the board's descriptions at load) queues whole before any is sent. Reads of
 * one asset share one request, queued or in flight. A caller's signal that aborts while its read
 * waits rejects that caller and drops the read if no one else waits for it; once the request is
 * sent, cancellation releases that caller without disrupting others. Shared requests time out
 * after thirty seconds and abort their transport. On the thread the engine renders on.
 */
export class RecordReads {
  private readonly queued = new Map<AssetId, Waiter[]>();
  private readonly inFlight = new Map<AssetId, Waiter[]>();
  private readonly controllers = new Set<AbortController>();
  private activeRequests = 0;
  private deferredUntil = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private visible: ReadonlySet<AssetId> = new Set();
  private near: ReadonlySet<AssetId> = new Set();
  private isPumpQueued = false;

  /**
   * No reads yet.
   *
   * @param readRecord - Sends one record request.
   * @param maxInFlight - The most requests at once; {@link MAX_RECORD_READS} by default.
   * @param readBatch - Optional fifty-ID transport; null results are per-asset refusals.
   */
  constructor(
    private readonly readRecord: (assetId: AssetId, signal: AbortSignal) => Promise<AssetRecord>,
    private readonly maxInFlight = MAX_RECORD_READS,
    private readonly readBatch?: (
      ids: readonly AssetId[],
      signal: AbortSignal,
    ) => Promise<(AssetRecord | null)[]>,
  ) {}

  /**
   * How many requests are in flight.
   *
   * @returns The count.
   */
  get inFlightCount(): number {
    return this.activeRequests;
  }

  /**
   * Which assets go first: those of the images on screen, then those near the view.
   *
   * @param visible - The visible images' assets.
   * @param near - The assets of the images near the view or ahead of the pan.
   */
  setPriorities(visible: ReadonlySet<AssetId>, near: ReadonlySet<AssetId>): void {
    this.visible = visible;
    this.near = near;
  }

  /**
   * Reads an asset's record, when a slot is free and its turn comes.
   *
   * @param assetId - The asset.
   * @param signal - Rejects this caller promptly, queued or in flight.
   * @returns The record; rejects as the request does, or with the signal's reason.
   */
  read(assetId: AssetId, signal?: AbortSignal): Promise<AssetRecord> {
    if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
    const running = this.inFlight.get(assetId);
    return new Promise<AssetRecord>((resolve, reject) => {
      const onAbort = () => {
        this.abandon(assetId, waiter, signal?.reason);
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const waiter: Waiter = {
        resolve: (record) => {
          cleanup();
          resolve(record);
        },
        reject: (reason) => {
          cleanup();
          const error = reason as Error;
          reject(error);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (running !== undefined) {
        running.push(waiter);
        return;
      }
      const waiters = this.queued.get(assetId) ?? [];
      waiters.push(waiter);
      this.queued.set(assetId, waiters);
      this.queuePump();
    });
  }

  /**
   * Rejects every waiting or active caller and aborts owned transports (the board's source is
   * gone). Late transport completions cannot deliver results after this reset.
   */
  clear(): void {
    const waiting = [...this.queued.values(), ...this.inFlight.values()].flat();
    this.queued.clear();
    this.inFlight.clear();
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.deferredUntil = 0;
    for (const controller of this.controllers) controller.abort();
    for (const waiter of waiting) waiter.reject(new Error('The board’s images were closed.'));
  }

  /**
   * Stops a caller waiting: rejects it and drops the read when no one else waits for it.
   *
   * @param assetId - The asset.
   * @param waiter - The caller.
   * @param reason - Why: the signal's reason.
   */
  private abandon(assetId: AssetId, waiter: Waiter, reason: unknown): void {
    const waiters = this.queued.get(assetId) ?? this.inFlight.get(assetId);
    const index = waiters?.indexOf(waiter) ?? -1;
    if (waiters !== undefined && index >= 0) {
      waiters.splice(index, 1);
      if (waiters.length === 0) this.queued.delete(assetId);
    }
    waiter.reject(reason);
  }

  /**
   * Pumps once the current burst of reads has queued (a microtask later): the engine describes a
   * board's images together, and the images on screen should go first, not the first asked for.
   */
  private queuePump(): void {
    if (this.isPumpQueued) return;
    this.isPumpQueued = true;
    queueMicrotask(() => {
      this.isPumpQueued = false;
      this.pump();
    });
  }

  /** Sends the next reads while slots are free. */
  private pump(): void {
    if (Date.now() < this.deferredUntil) {
      this.retryTimer ??= setTimeout(
        () => {
          this.retryTimer = undefined;
          this.pump();
        },
        Math.min(this.deferredUntil - Date.now(), 2_147_483_647),
      );
      return;
    }
    while (this.activeRequests < this.maxInFlight) {
      const selected = new Map<AssetId, Waiter[]>();
      for (let index = 0; index < (this.readBatch === undefined ? 1 : 50); index += 1) {
        const assetId = this.next();
        if (assetId === undefined) break;
        const waiters = this.queued.get(assetId) ?? [];
        this.queued.delete(assetId);
        selected.set(assetId, waiters);
        this.inFlight.set(assetId, waiters);
      }
      if (selected.size === 0) return;
      this.activeRequests += 1;
      void this.request([...selected.keys()])
        .then(
          (records) => {
            this.deliver(selected, records);
          },
          (error: unknown) => {
            this.refused(selected, error);
          },
        )
        .finally(() => {
          for (const [assetId, waiters] of selected) {
            if (this.inFlight.get(assetId) === waiters) this.inFlight.delete(assetId);
          }
          this.activeRequests -= 1;
          this.pump();
        });
    }
  }

  private deliver(
    selected: ReadonlyMap<AssetId, Waiter[]>,
    records: readonly (AssetRecord | null)[],
  ): void {
    let index = 0;
    for (const [assetId, waiters] of selected) {
      const record = records[index++];
      if (this.inFlight.get(assetId) !== waiters) continue;
      this.inFlight.delete(assetId);
      for (const waiter of waiters) {
        if (record === null || record === undefined)
          waiter.reject(new AssetsHttpError(404, 'not-found', 'The asset is not available.'));
        else waiter.resolve(record);
      }
    }
  }

  private refused(selected: ReadonlyMap<AssetId, Waiter[]>, error: unknown): void {
    const isDeferred = error instanceof AssetsHttpError && error.status === 429;
    let hasDeferredWaiter = false;
    for (const [assetId, waiters] of selected) {
      if (this.inFlight.get(assetId) !== waiters) continue;
      if (isDeferred && waiters.length > 0) {
        this.queued.set(assetId, waiters);
        hasDeferredWaiter = true;
      } else for (const waiter of waiters) waiter.reject(error);
    }
    if (!isDeferred || !hasDeferredWaiter) return;
    const delay = Number.isFinite(error.retryAfterMs)
      ? Math.max(1000, error.retryAfterMs ?? 1000)
      : 1000;
    this.deferredUntil = Math.max(this.deferredUntil, Date.now() + delay);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        this.pump();
      },
      Math.min(this.deferredUntil - Date.now(), 2_147_483_647),
    );
  }

  /**
   * Bounds a shared read independently of whether its transport honours cancellation.
   *
   * @param assetIds - The batch to read.
   * @returns The records, or a timeout refusal after the transport is aborted.
   */
  private async request(assetIds: readonly AssetId[]): Promise<(AssetRecord | null)[]> {
    const controller = new AbortController();
    this.controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((unused, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException('The asset record request timed out.', 'TimeoutError');
        reject(error);
        controller.abort(error);
      }, RECORD_READ_TIMEOUT_MS);
    });
    try {
      const request =
        this.readBatch === undefined
          ? Promise.all(assetIds.map((assetId) => this.readRecord(assetId, controller.signal)))
          : this.readBatch(assetIds, controller.signal);
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  /**
   * The asset whose read goes next: on screen, then near the view, then the longest queued.
   *
   * @returns The asset, or undefined when nothing waits.
   */
  private next(): AssetId | undefined {
    return (
      firstQueuedIn(this.visible, this.queued) ??
      firstQueuedIn(this.near, this.queued) ??
      this.queued.keys().next().value
    );
  }
}
