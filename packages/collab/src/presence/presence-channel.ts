import { removeAwarenessStates } from 'y-protocols/awareness';
import type { Awareness } from 'y-protocols/awareness';

import { applyChangedClients } from './inbound-coalescing.js';
import {
  DEFAULT_PRESENCE_RATE_HZ,
  decideOutbound,
  presenceIntervalMs,
} from './outbound-throttle.js';
import {
  DEFAULT_PRESENCE_TIMEOUT_MS,
  MAX_PRESENCE_TIMEOUT_MS,
  MIN_PRESENCE_TIMEOUT_MS,
  resolvePresencePrincipal,
  type PresenceChannelOptions,
} from './presence-channel-options.js';
import { editingOnBoard } from './presence-editing.js';
import { mergePresence } from './presence-merge.js';
import type {
  PresenceClientId,
  PresenceSnapshot,
  PresenceState,
  PresenceUpdate,
} from './presence-state.js';
import { systemPresenceClock, timeoutPresenceScheduler } from './presence-time.js';
import type { PresenceClock, PresenceScheduler, PresenceTimer } from './presence-time.js';
import { findStaleClients, nextSweepDelayMs } from './stale-clients.js';

export {
  DEFAULT_PRESENCE_TIMEOUT_MS,
  MAX_PRESENCE_TIMEOUT_MS,
  MIN_PRESENCE_TIMEOUT_MS,
} from './presence-channel-options.js';
export type { PresenceChannelOptions, PresencePrincipalInput } from './presence-channel-options.js';

/** Receives the remote presence whenever it changes, at most once per inbound flush. */
export type PresenceListener = (snapshot: PresenceSnapshot) => void;

interface AwarenessChange {
  readonly added: readonly PresenceClientId[];
  readonly updated: readonly PresenceClientId[];
  readonly removed: readonly PresenceClientId[];
}

/**
 * Presence over Yjs awareness: the local client's cursor,
 * selection, viewport, name and colour going out at 20–30 Hz, and every remote client's coming
 * in as one coalesced snapshot per flush. Presence lives only in awareness, never in the board
 * document, so it is never persisted.
 *
 * Outbound, {@link PresenceChannel.setLocal} merges into the local state and a leading-edge
 * throttle with a trailing flush writes it to awareness, so a 60 Hz pointer stream costs at most
 * `rateHz` messages a second and the last position always goes out. Inbound, awareness changes are
 * collected per client and folded into a new snapshot once per flush. A remote client silent for
 * `timeoutMs` is removed; the local state is re-sent every half of the local timeout, alongside
 * y-protocols' own renewal. Main thread, worker or Node; no DOM.
 */
export class PresenceChannel {
  private readonly awareness: Awareness;
  private readonly clock: PresenceClock;
  private readonly scheduler: PresenceScheduler;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly listeners = new Set<PresenceListener>();
  private readonly pendingClients = new Set<PresenceClientId>();
  private readonly lastSeenAtMs = new Map<PresenceClientId, number>();
  private local: PresenceState;
  private lastSentAtMs: number | undefined;
  private outboundTimer: PresenceTimer | undefined;
  private inboundTimer: PresenceTimer | undefined;
  private sweepTimer: PresenceTimer | undefined;
  private snapshot: PresenceSnapshot = new Map();
  private notifiedSnapshot: PresenceSnapshot = this.snapshot;
  private isDestroyed = false;
  private isHidden = false;
  private readonly objectExists: ((objectId: string) => boolean) | undefined;
  private readonly show: (state: PresenceState) => PresenceState;

  /**
   * Starts presence for the local client: broadcasts its principal at once and begins
   * listening to remote clients already known to `awareness` and any that join.
   *
   * @param options - The awareness instance, the local principal, the rate and the timeout.
   * @throws {RangeError} When the rate is outside 20 to 30 Hz, the timeout is outside 20 to
   *   30 s, or the principal is malformed.
   */
  constructor(options: PresenceChannelOptions) {
    this.awareness = options.awareness;
    this.clock = options.clock ?? systemPresenceClock;
    this.scheduler = options.scheduler ?? timeoutPresenceScheduler;
    this.intervalMs = presenceIntervalMs(options.rateHz ?? DEFAULT_PRESENCE_RATE_HZ);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PRESENCE_TIMEOUT_MS;
    this.objectExists = options.objectExists;
    this.show = editingOnBoard(options.objectExists);
    if (!(this.timeoutMs >= MIN_PRESENCE_TIMEOUT_MS && this.timeoutMs <= MAX_PRESENCE_TIMEOUT_MS)) {
      throw new RangeError(
        `A presence timeout is ${String(MIN_PRESENCE_TIMEOUT_MS)} to ` +
          `${String(MAX_PRESENCE_TIMEOUT_MS)} ms; received ${String(this.timeoutMs)}.`,
      );
    }
    this.local = {
      principal: resolvePresencePrincipal(options.principal),
      updatedAt: this.clock.now(),
    };
    this.awareness.on('update', this.handleUpdate);
    this.awareness.on('change', this.handleChange);
    this.awareness.on('destroy', this.handleAwarenessDestroy);
    this.send();
    this.seedRemote();
    this.scheduleSweep();
  }

  /**
   * The local client's awareness id, the key other clients' snapshots hold it under.
   *
   * @returns The Yjs client id of the awareness document.
   */
  get clientId(): PresenceClientId {
    return this.awareness.clientID;
  }

  /**
   * The local presence as last merged; it may not have gone out yet.
   *
   * @returns The local state.
   */
  getLocal(): PresenceState {
    return this.local;
  }

  /**
   * Merges a change into the local presence and sends it within the rate: now if the last
   * send is an interval old, otherwise in the trailing flush at the interval's end.
   *
   * @param update - The fields to replace (`null` clears one).
   * @throws {RangeError} When the cursor, viewport or selection is malformed.
   */
  setLocal(update: PresenceUpdate): void {
    if (this.isDestroyed) {
      return;
    }
    const nowMs = this.clock.now();
    this.local = mergePresence(this.local, update, nowMs);
    const decision = decideOutbound(
      { lastSentAtMs: this.lastSentAtMs, isFlushPending: this.outboundTimer !== undefined },
      nowMs,
      this.intervalMs,
    );
    if (decision.kind === 'send-now') {
      this.send();
    } else if (decision.kind === 'flush-later') {
      this.outboundTimer = this.scheduler.schedule(() => {
        this.outboundTimer = undefined;
        this.send();
      }, decision.delayMs);
    }
  }

  /**
   * Every remote client's presence, including changes that arrived since the last flush.
   *
   * @returns The snapshot; the same object until something changes.
   */
  getRemote(): PresenceSnapshot {
    this.applyPending();
    return this.snapshot;
  }

  /**
   * Checks every remote editing claim against the board again, in the next inbound
   * flush: call it after the document changed, so a claim on an object that arrived late shows
   * and one on an object deleted since is dropped. Only clients whose state claims an edit are
   * looked at; with none, it does nothing.
   */
  recheckEditing(): void {
    if (this.isDestroyed || this.objectExists === undefined) return;
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId !== this.clientId && (state as { editing?: unknown }).editing !== undefined) {
        this.pendingClients.add(clientId);
      }
    }
    this.scheduleInbound();
  }

  /**
   * Calls `listener` with the new snapshot after each inbound flush that changed it.
   *
   * @param listener - Receives the snapshot.
   * @returns A function that unsubscribes the listener.
   */
  subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Hides the local client from its peers, or shows it again (an idle pooled client):
   * hiding clears the local awareness state, so peers see the client leave, and holds every send,
   * renewal included; showing sends the local state as last merged. Remote presence keeps flowing.
   *
   * @param isHidden - Whether the local client is hidden.
   */
  setHidden(isHidden: boolean): void {
    if (this.isDestroyed || isHidden === this.isHidden) return;
    this.isHidden = isHidden;
    if (!isHidden) {
      this.send();
      return;
    }
    this.outboundTimer?.cancel();
    this.outboundTimer = undefined;
    this.awareness.setLocalState(null);
  }

  /**
   * Stops presence: cancels pending work, stops listening and clears the local state, which
   * tells peers the client has left.
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    for (const timer of [this.outboundTimer, this.inboundTimer, this.sweepTimer]) {
      timer?.cancel();
    }
    this.awareness.off('update', this.handleUpdate);
    this.awareness.off('change', this.handleChange);
    this.awareness.off('destroy', this.handleAwarenessDestroy);
    this.listeners.clear();
    this.awareness.setLocalState(null);
  }

  // A destroyed awareness never syncs again, so the sweep chain must not outlive it.
  private readonly handleAwarenessDestroy = (): void => {
    this.destroy();
  };

  private send(): void {
    if (this.isHidden) return;
    this.lastSentAtMs = this.clock.now();
    this.awareness.setLocalState({ ...this.local });
  }

  private readonly handleUpdate = (change: AwarenessChange, origin: unknown): void => {
    if (origin === 'local') {
      return;
    }
    const nowMs = this.clock.now();
    for (const clientId of [...change.added, ...change.updated]) {
      if (clientId !== this.clientId) {
        this.lastSeenAtMs.set(clientId, nowMs);
      }
    }
    for (const clientId of change.removed) {
      this.lastSeenAtMs.delete(clientId);
    }
  };

  private readonly handleChange = (change: AwarenessChange, origin: unknown): void => {
    if (origin === 'local') {
      return;
    }
    for (const clientId of [...change.added, ...change.updated, ...change.removed]) {
      this.pendingClients.add(clientId);
    }
    this.scheduleInbound();
  };

  private scheduleInbound(): void {
    if (this.pendingClients.size === 0) return;
    this.inboundTimer ??= this.scheduler.schedule(() => {
      this.inboundTimer = undefined;
      this.flushInbound();
    }, 0);
  }

  private seedRemote(): void {
    const nowMs = this.clock.now();
    for (const clientId of this.awareness.getStates().keys()) {
      if (clientId !== this.clientId) {
        this.lastSeenAtMs.set(clientId, nowMs);
        this.pendingClients.add(clientId);
      }
    }
    this.applyPending();
    this.notifiedSnapshot = this.snapshot;
  }

  private applyPending(): void {
    if (this.pendingClients.size === 0) {
      return;
    }
    const states = this.awareness.getStates();
    this.snapshot = applyChangedClients(
      this.snapshot,
      this.pendingClients,
      (clientId) => states.get(clientId),
      this.clientId,
      this.show,
    );
    this.pendingClients.clear();
  }

  private flushInbound(): void {
    this.applyPending();
    if (this.snapshot === this.notifiedSnapshot) {
      return;
    }
    this.notifiedSnapshot = this.snapshot;
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch (error: unknown) {
        // One failing subscriber must not starve the others or break the flush; its error is
        // rethrown on its own, where the host's error reporting sees it.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  private scheduleSweep(): void {
    this.sweepTimer = this.scheduler.schedule(
      () => {
        this.sweep();
        this.scheduleSweep();
      },
      nextSweepDelayMs(this.lastSeenAtMs, this.clock.now(), this.timeoutMs, this.timeoutMs / 10),
    );
  }

  private sweep(): void {
    const nowMs = this.clock.now();
    const stale = findStaleClients(this.lastSeenAtMs, nowMs, this.timeoutMs);
    if (stale.length > 0) {
      for (const clientId of stale) {
        this.lastSeenAtMs.delete(clientId);
      }
      removeAwarenessStates(this.awareness, stale, 'timeout');
    }
    const isRenewalDue =
      this.outboundTimer === undefined &&
      (this.lastSentAtMs === undefined || nowMs - this.lastSentAtMs >= this.timeoutMs / 2);
    if (isRenewalDue) {
      this.send();
    }
  }
}
