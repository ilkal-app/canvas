import type { Awareness } from 'y-protocols/awareness';

import { SYSTEM_ORIGIN, type DocumentStore, type DocumentUpdate } from '@canvas/document';

import type { CacheRecovery } from '../cache/cache-recovery.js';
import type { DocumentCacheBinding } from '../cache/document-cache-binding.js';
import type { LayoutCarryOver } from '../cache/layout-carry-over.js';
import { reportAsynchronously } from '../errors/report-asynchronously.js';
import type { PresenceChannel } from '../presence/presence-channel.js';
import {
  systemPresenceClock,
  timeoutPresenceScheduler,
  type PresenceClock,
  type PresenceScheduler,
} from '../presence/presence-time.js';
import { DEFAULT_RECONNECT_BACKOFF } from '../reconnect/reconnect-delay.js';

import { BoardNotices } from './board-notices.js';
import type { BoardTokenClaims } from './board-token.js';
import {
  carryOverAtFirstSync,
  createLayoutCarryOver,
  storedUpdatesReader,
} from './client-cache-lifecycle.js';
import { createClientAwareness, createClientPresence } from './client-presence.js';
import type {
  CollabClientOptions,
  CollabStatus,
  CollabStatusListener,
} from './collab-client-options.js';
import { CollabStatusHolder } from './collab-status-holder.js';
import { ConnectionTokens } from './connection-tokens.js';
import { createBrowserNetworkStatus, type NetworkStatus } from './network-status.js';
import { OutboundQueue } from './outbound-queue.js';
import { RelayLink } from './relay-link.js';
import { RELAY_AWARENESS_ORIGIN } from './relay-protocol.js';
import { repairModeFor } from './repair-mode-for.js';
import { SyncTimer, type SyncTimings } from './sync-timings.js';
import type { TokenSource } from './token-source.js';

/** The first token of a client, as `createCollabClient` fetched it, and where later ones come from. */
export interface CollabClientSession {
  /** The first token's claims; `boardId` already checked. */
  readonly claims: BoardTokenClaims;
  /** The first token: the first connection authenticates with it. */
  readonly token: string;
  /** Where the tokens of later connections come from. */
  readonly tokens: TokenSource;
  /** Terminal refusal discovered while restoring the cache; no socket may open. */
  readonly rejectionReason?: string | undefined;
  /** Automatic retained-cache recovery on this fresh open. */
  readonly recovery?: CacheRecovery | undefined;
}

interface AwarenessChange {
  readonly added: readonly number[];
  readonly updated: readonly number[];
  readonly removed: readonly number[];
}

/**
 * The sync client of one board: connects a `DocumentStore` to
 * the relay, keeps presence on the connection's awareness, and exposes where it stands. Local
 * edits are accepted in every state; while the client cannot reach the relay they are counted
 * as pending, and the next connection's handshake (state vectors both ways) sends exactly what
 * the relay lacks and receives exactly what the client lacks. A lost connection is retried
 * with exponential backoff and jitter, each attempt with a fresh token from the provider; a
 * refused token is retried once, at once, with a fresh token, and a second refusal (or a fresh
 * token equal to the refused one) is final. Built by `createCollabClient`, which fetches the
 * first token and loads the cached board first. Main thread or worker.
 */
export class CollabClient {
  /** The board this client syncs. */
  readonly boardId: string;
  /** Who the token says the client is; presence uses the same identity. */
  readonly claims: BoardTokenClaims;
  /** The awareness the connection carries; presence runs on it. */
  readonly awareness: Awareness;
  /** Presence for the local principal, when the options asked for it. */
  readonly presence: PresenceChannel | undefined;
  /**
   * Carries the board's unsent edits over a stored-layout bump, once, when the first
   * sync completes; what it could not carry is in its `stranded` until dismissed. Present when
   * the client has a cache with earlier layouts.
   */
  readonly layoutCarryOver: LayoutCarryOver | undefined;
  /** Retained cache sources and recovery/export status, when present. */
  readonly recovery: CacheRecovery | undefined;
  /** The cache's pending writes (the shell holds a reload on them), with a cache. */
  readonly cacheWrites: DocumentCacheBinding['writes'] | undefined;
  readonly #store: DocumentStore;
  readonly #options: CollabClientOptions;
  readonly #clock: PresenceClock;
  readonly #scheduler: PresenceScheduler;
  readonly #network: NetworkStatus;
  readonly #queue = new OutboundQueue();
  readonly #cacheBinding: DocumentCacheBinding | undefined;
  readonly #cleanups: (() => void)[] = [];
  readonly #status: CollabStatusHolder;
  readonly #link: RelayLink;
  readonly #notices = new BoardNotices((error) => {
    (this.#options.onError ?? reportAsynchronously)(error);
  });
  readonly #syncTimer = new SyncTimer();
  #isDisconnectRequested = false;
  #isDestroyed = false;
  #isApplyingRemote = false;

  /**
   * Starts syncing: listens to the store, the awareness and the network, and opens the first
   * connection unless the device is offline.
   *
   * @param options - The client's options.
   * @param session - The first token, its claims and the source of later tokens.
   * @param cacheBinding - The store's cache binding, which the client destroys with itself.
   */
  constructor(
    options: CollabClientOptions,
    session: CollabClientSession,
    cacheBinding: DocumentCacheBinding | undefined,
  ) {
    const { claims } = session;
    this.boardId = options.boardId;
    this.claims = claims;
    this.recovery = session.recovery;
    this.#store = options.store;
    this.#store.setRepairMode(repairModeFor(claims));
    this.#options = options;
    this.#clock = options.clock ?? systemPresenceClock;
    this.#scheduler = options.scheduler ?? timeoutPresenceScheduler;
    this.awareness = createClientAwareness(this.#store);
    this.presence = createClientPresence(this.awareness, claims, options, {
      clock: this.#clock,
      scheduler: this.#scheduler,
    });
    this.#network = options.network ?? createBrowserNetworkStatus();
    this.#status = this.#createStatus(session);
    const readCacheUpdates = storedUpdatesReader(options, cacheBinding);
    const readStoredUpdates =
      readCacheUpdates === undefined
        ? undefined
        : () => (this.recovery?.isPublished === false ? Promise.resolve([]) : readCacheUpdates());
    this.#link = new RelayLink({
      ...(readStoredUpdates === undefined ? {} : { readStoredUpdates }),
      options,
      onNotice: (kind) => {
        this.#notices.notify(kind);
      },
      scheduler: this.#scheduler,
      backoff: { ...DEFAULT_RECONNECT_BACKOFF, ...options.reconnect },
      tokens: new ConnectionTokens(session.tokens, session.token, options.boardId),
      status: this.#status,
      store: this.#store,
      awareness: this.awareness,
      queue: this.#queue,
      syncTimer: this.#syncTimer,
      applyRemoteUpdate: (update) => {
        this.#applyRemoteUpdate(update);
      },
      checkSynced: () => {
        this.#checkSynced();
      },
    });
    // A dropped connection is closed just before the state leaves `connected`, whose transition
    // sets the field false: nothing is derived in between, so listeners see one change.
    this.#status.deriveWith((status) =>
      status.state === 'connected' && this.#link.connection === undefined
        ? {}
        : { isAcknowledged: this.#isAcknowledged(status) },
    );
    this.layoutCarryOver = createLayoutCarryOver(options, cacheBinding);
    this.#cacheBinding = cacheBinding;
    this.cacheWrites = cacheBinding?.writes;
    // Unsent work stays in the log, one record per transaction, until the relay has it.
    cacheBinding?.holdCompactionWhile(
      () => !this.#isAcknowledged() || this.recovery?.isPublished === false,
    );
    this.awareness.on('update', this.#onAwarenessUpdate);
    this.#cleanups.push(
      this.recovery?.attach(this, () => {
        this.#checkSynced();
      }) ?? (() => undefined),
      carryOverAtFirstSync(this.layoutCarryOver, this.#status),
      this.#syncTimer.markSyncedOn(this.#status),
      this.#store.subscribeUpdates(this.#onStoreUpdate),
      this.#network.subscribe(this.#onNetworkChange),
      () => cacheBinding?.destroy(),
      () => {
        this.awareness.off('update', this.#onAwarenessUpdate);
        this.awareness.destroy();
        this.awareness.doc.destroy();
      },
    );
    if (this.#status.current.state === 'connecting') this.#link.open();
  }

  /**
   * Builds the initial status before opening transport.
   *
   * @param session - The authenticated open result.
   * @returns Initial observable state.
   */
  #createStatus(session: CollabClientSession): CollabStatusHolder {
    return new CollabStatusHolder({
      state:
        session.rejectionReason !== undefined
          ? 'outdated'
          : this.#network.isOnline()
            ? 'connecting'
            : 'offline',
      lastSyncedAt: undefined,
      pendingUpdateCount: 0,
      isReadOnly: false,
      isAcknowledged: false,
      rejectionReason: session.rejectionReason,
    });
  }

  /**
   * Where the client stands.
   *
   * @returns The current status; the same object until something changes.
   */
  get status(): CollabStatus {
    return this.#status.current;
  }

  /**
   * When the client last knew it held the relay's board, in ms on its clock.
   *
   * @returns The time, or `undefined` before the first sync.
   */
  get lastSyncedAt(): number | undefined {
    return this.#status.current.lastSyncedAt;
  }

  /**
   * How long the first sync spent authenticating, receiving and applying ({@link SyncTimings},
   *); fixed once it is done, so reconnections never change them.
   *
   * @returns The timings, or `undefined` before the first sync.
   */
  syncTimings(): SyncTimings | undefined {
    return this.#syncTimer.timings;
  }

  /**
   * Calls `listener` with the status after every change.
   *
   * @param listener - Receives the status.
   * @returns A function that stops listening.
   */
  subscribe(listener: CollabStatusListener): () => void {
    return this.#status.subscribe(listener);
  }

  /**
   * Subscribes to board-scoped comment invalidations; fetch threads after each notice.
   *
   * @param listener - Called when the boards service changes this board's threads.
   * @returns An unsubscribe function.
   */
  onThreadsChanged(listener: () => void): () => void {
    return this.#notices.subscribe('threads', listener);
  }

  /**
   * Subscribes to the board's dot-vote invalidations; fetch the vote after each notice.
   * The notice carries no votes: the boards service answers what the reader may see.
   *
   * @param listener - Called when the boards service changes this board's vote.
   * @returns An unsubscribe function.
   */
  onVotesChanged(listener: () => void): () => void {
    return this.#notices.subscribe('votes', listener);
  }

  /** Goes offline on purpose: closes the connection and stops retrying until `connect()`. */
  disconnect(): void {
    this.#isDisconnectRequested = true;
    this.#status.transition('offline');
    this.#link.close();
  }

  /** Undoes `disconnect()`: connects at once unless the device is offline or it is refused. */
  connect(): void {
    this.#isDisconnectRequested = false;
    this.#resume();
  }

  /**
   * Stops syncing for good: clears the local presence (peers see the client leave), closes the
   * connection and releases every listener. The store and the cache stay usable.
   */
  destroy(): void {
    if (this.#isDestroyed) return;
    this.presence?.destroy();
    this.#isDestroyed = true;
    this.#status.transition('offline');
    this.#link.close();
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
    this.#status.clear();
    this.#notices.clear();
  }

  /** Connects afresh after coming back online or `connect()`, when allowed. */
  #resume(): void {
    const isAllowed = !this.#isDisconnectRequested && !this.#isDestroyed;
    if (!isAllowed || this.#status.current.state !== 'offline') return;
    if (!this.#network.isOnline()) return;
    this.#link.resetBackoff();
    this.#status.transition('online');
    this.#link.open();
  }

  /**
   * Applies a relayed update to the store, marked so it is not sent back.
   *
   * @param update - The update bytes.
   */
  #applyRemoteUpdate(update: Uint8Array): void {
    this.#isApplyingRemote = true;
    try {
      this.#store.applyUpdate(update, SYSTEM_ORIGIN);
    } finally {
      this.#isApplyingRemote = false;
    }
  }

  /** Records a sync when connected and nothing is pending. */
  #checkSynced(): void {
    const isHolding = this.#link.connection?.hasHeldInbound === true;
    const isSynced = this.#status.current.state === 'connected' && this.#queue.isSettled;
    this.#status.update({
      pendingUpdateCount: this.#queue.pendingCount,
      ...(isSynced && !isHolding ? { lastSyncedAt: this.#clock.now() } : {}),
    });
    if (this.#isAcknowledged()) this.#cacheBinding?.resumeCompaction();
  }

  /**
   * Cache compaction waits for initial sync and all publishable acknowledgements; read-only work never holds it forever. The status's isAcknowledged field follows this result.
   *
   * @param status - Current or proposed status.
   * @returns Whether cache compaction can resume.
   */
  #isAcknowledged(status: CollabStatus = this.#status.current): boolean {
    const { state, isReadOnly } = status;
    return (
      state === 'connected' &&
      this.recovery?.isPending !== true &&
      this.#link.connection?.isLive === true &&
      !this.#link.connection.hasHeldInbound &&
      (this.#queue.isSettled || isReadOnly)
    );
  }

  /**
   * Sends a local update live, or counts it as pending until the next handshake. A relayed
   * update (applied by this client) is not sent back; Yjs's own formatting clean-up after it
   * is local, and is sent.
   *
   * @param documentUpdate - The store's update.
   */
  readonly #onStoreUpdate = (documentUpdate: DocumentUpdate): void => {
    if (this.#isApplyingRemote && !documentUpdate.isLocal) return;
    const connection = this.#link.connection;
    if (connection?.isLive === true) {
      connection.sendUpdate(documentUpdate.update);
    } else {
      this.#queue.hold(documentUpdate.update);
    }
    this.#status.update({ pendingUpdateCount: this.#queue.pendingCount });
  };

  /**
   * Sends local awareness changes on the open connection.
   *
   * @param change - The clients whose states changed.
   * @param origin - Who changed them; the connection's own changes are not sent back.
   */
  readonly #onAwarenessUpdate = (change: AwarenessChange, origin: unknown): void => {
    if (origin === RELAY_AWARENESS_ORIGIN) return;
    this.#link.connection?.sendAwareness([...change.added, ...change.updated, ...change.removed]);
  };

  /**
   * Stops retrying when the device goes offline; connects at once when it comes back.
   *
   * @param isOnline - The device's new network state.
   */
  readonly #onNetworkChange = (isOnline: boolean): void => {
    if (isOnline) {
      this.#resume();
    } else {
      this.#status.transition('offline');
      this.#link.close();
    }
  };
}
