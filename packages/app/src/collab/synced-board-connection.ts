import type {
  PresenceCursor,
  PresenceEditing,
  PresenceSnapshot,
  PresenceSpotlight,
  PresenceState,
  PresenceViewport,
  ReactionChannel,
  ServerClock,
} from '@canvas/collab';
import type { DocumentStore, TransactionOrigin } from '@canvas/document';

import {
  collaboratorsOf,
  NO_STRANDED_EDITS,
  type BoardConnectionStatus,
} from './board-connection-status.js';
import type { BoardConnection, BoardSyncClient } from './board-connection.js';
import { isReadOnlyRole } from './read-only-role.js';

/** The device cache a synced board was opened with. */
export interface SyncedBoardCache {
  /** Whether a cache opened, so the board is kept on this device. */
  readonly isSavedOnDevice: boolean;
  /** Closes it, once the connection is destroyed. */
  readonly release: () => void;
}

/**
 * A board kept in step with the relay by a collab client: its status follows the client's, its
 * presence and its layout carry-over (edits a layout bump stranded, which the person
 * may dismiss). It owns the client and the store and releases both when destroyed. Main thread.
 */
export class SyncedBoardConnection implements BoardConnection {
  readonly store: DocumentStore;
  readonly origin: TransactionOrigin;
  /** @inheritdoc */
  readonly serverClock: Pick<ServerClock, 'now'> | undefined;
  /** @inheritdoc */
  readonly reactions: Pick<ReactionChannel, 'send' | 'subscribe'> | undefined;
  readonly #client: BoardSyncClient;
  readonly #listeners = new Set<() => void>();
  readonly #stops: (() => void)[];
  readonly #release: () => void;
  readonly #isSavedOnDevice: boolean;
  /** Whether the relay has answered a token yet, so the client's `isReadOnly` is its answer. */
  #hasRelayAnswered = false;
  #status: BoardConnectionStatus;

  /**
   * Follows a client.
   *
   * @param store - The synced store, which the connection destroys with itself.
   * @param client - The client syncing it, destroyed with the connection.
   * @param origin - The local user's origin.
   * @param cache - Whether the board is kept on this device, and how to free that cache.
   * @param channels - The client's estimate of the relay's clock and the board's
   *   reactions, where the client has them.
   * @param channels.serverClock - The clock.
   * @param channels.reactions - The reactions.
   */
  constructor(
    store: DocumentStore,
    client: BoardSyncClient,
    origin: TransactionOrigin,
    cache: SyncedBoardCache = { isSavedOnDevice: false, release: () => undefined },
    channels: {
      readonly serverClock?: Pick<ServerClock, 'now'>;
      readonly reactions?: Pick<ReactionChannel, 'send' | 'subscribe'>;
    } = {},
  ) {
    this.store = store;
    this.serverClock = channels.serverClock;
    this.reactions = channels.reactions;
    this.#isSavedOnDevice = cache.isSavedOnDevice;
    this.#release = cache.release;
    this.origin = origin;
    this.#client = client;
    this.#status = this.#read();
    const refresh = (): void => {
      this.#refresh();
    };
    this.#stops = [
      client.subscribe(refresh),
      client.presence?.subscribe(refresh) ?? (() => undefined),
      client.layoutCarryOver?.subscribe(refresh) ?? (() => undefined),
    ];
  }

  /**
   * Exposes retained device content.
   *
   * @returns Original retained device content and its read-only export capability.
   */
  get recovery(): BoardSyncClient['recovery'] {
    return this.#client.recovery;
  }

  /**
   * Exposes the client's device-cache writes.
   *
   * @returns The pending writes, or `undefined` without a cache.
   */
  get cacheWrites(): BoardSyncClient['cacheWrites'] {
    return this.#client.cacheWrites;
  }

  status(): BoardConnectionStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @inheritdoc */
  remotePresence(): PresenceSnapshot {
    return this.#client.presence?.getRemote() ?? new Map();
  }

  /** @inheritdoc */
  localPresence(): { readonly clientId: number; readonly state: PresenceState } | undefined {
    const presence = this.#client.presence;
    if (presence?.getLocal === undefined || presence.clientId === undefined) return undefined;
    return { clientId: presence.clientId, state: presence.getLocal() };
  }

  /** @inheritdoc */
  showSpotlight(spotlight: PresenceSpotlight | null): void {
    this.#client.presence?.setLocal?.({ spotlight });
  }

  /** @inheritdoc */
  showFollowing(principalId: string | null): void {
    this.#client.presence?.setLocal?.({ following: principalId });
  }

  /** @inheritdoc */
  showPage(pageId: string): void {
    this.#client.presence?.setLocal?.({ page: pageId });
  }

  /** @inheritdoc */
  showEditing(editing: PresenceEditing | null): void {
    this.#client.presence?.setLocal?.({ editing });
  }

  /** @inheritdoc */
  showViewport(viewport: PresenceViewport | null): void {
    this.#client.presence?.setLocal?.({ viewport });
  }

  /** @inheritdoc */
  showCursor(cursor: PresenceCursor | null): void {
    this.#client.presence?.setLocal?.({ cursor });
  }

  /** @inheritdoc */
  showSelection(ids: readonly string[] | null): void {
    this.#client.presence?.setLocal?.({ selection: ids });
  }

  /**
   * Forwards board-scoped comment notices.
   *
   * @param listener - Fetches the latest threads.
   * @returns Stops listening.
   */
  onThreadsChanged(listener: () => void): () => void {
    return this.#client.onThreadsChanged?.(listener) ?? (() => undefined);
  }

  /**
   * Forwards the board's dot-vote notices.
   *
   * @param listener - Fetches the vote again.
   * @returns Stops listening.
   */
  onVotesChanged(listener: () => void): () => void {
    return this.#client.onVotesChanged?.(listener) ?? (() => undefined);
  }

  /**
   * Reconnects at once ('s Retry now): the client goes offline on purpose and comes back,
   * which starts a fresh attempt with its backoff reset; while the device is offline the client
   * stays offline, and once refused for good it stays refused. Nothing for a client without
   * `connect` and `disconnect` (a test's fake).
   */
  retryNow(): void {
    const client = this.#client;
    if (client.connect === undefined || client.disconnect === undefined) return;
    client.disconnect();
    client.connect();
  }

  /**
   * Stops the client for good (it closes its link, leaves presence and never reconnects), while
   * the store and the device's cache stay as they are; `destroy` still releases them.
   */
  stopSyncing(): void {
    this.#client.destroy();
  }

  dismissStrandedEdits(source: string): void {
    void this.#client.layoutCarryOver?.dismiss(source);
  }

  destroy(): void {
    for (const stop of this.#stops.splice(0)) stop();
    this.#listeners.clear();
    this.#client.destroy();
    this.store.destroy();
    this.#release();
  }

  /** Reads the status anew and tells listeners. */
  #refresh(): void {
    this.#status = this.#read();
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * The status as the client and presence stand now.
   *
   * @returns A new frozen status.
   */
  #read(): BoardConnectionStatus {
    const { state, pendingUpdateCount, isReadOnly, isAcknowledged, rejectionReason } =
      this.#client.status;
    // The relay answers each token before the sync that makes the client `connected`; until it
    // first has, the first token's role stands for it.
    if (state === 'connected') this.#hasRelayAnswered = true;
    const { boardId, role, lock } = this.#client.claims;
    return Object.freeze({
      boardId,
      state,
      isLocalOnly: false,
      isSavedOnDevice: this.#isSavedOnDevice,
      pendingUpdateCount,
      isAcknowledged,
      isReadOnly: this.#hasRelayAnswered ? isReadOnly : isReadOnlyRole(role),
      rejectionReason,
      ...(lock === undefined ? {} : { planLock: lock }),
      collaborators: Object.freeze(
        collaboratorsOf(this.#client.presence?.getRemote() ?? new Map()),
      ),
      strandedEdits: this.#client.layoutCarryOver?.stranded ?? NO_STRANDED_EDITS,
    });
  }
}
