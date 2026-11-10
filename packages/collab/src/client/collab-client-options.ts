import type { DocumentStore } from '@canvas/document';

import type { DocumentCache } from '../cache/document-cache.js';
import type { IdleScheduler } from '../cache/idle-scheduler.js';
import type { LayoutConverters } from '../cache/layout-converters.js';
import type { ServerClock } from '../clock/server-clock.js';
import type { PresenceClock, PresenceScheduler } from '../presence/presence-time.js';
import type { ReactionChannel } from '../presence/reaction-channel.js';
import type { ReconnectBackoff } from '../reconnect/reconnect-delay.js';

import type { CollabSocketFactory } from './collab-socket.js';
import type { ConnectionState } from './connection-state.js';
import type { NetworkStatus } from './network-status.js';
import type { BoardTokenOptions } from './token-source.js';

/** How long the client waits for any frame before it drops a silent connection, in ms. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Presence for the client's own principal. Its id and kind come from the board token (`sub`
 * and `principal`), never from here, so presence matches what the relay attributes edits to.
 */
export interface CollabPresenceOptions {
  /** The display name drawn beside the cursor. */
  readonly name: string;
  /** The cursor colour, `#rrggbb`; derived from the principal id when omitted. */
  readonly color?: string;
  /** Outbound presence updates per second, 20 to 30 Hz. */
  readonly rateHz?: number;
  /** How long a silent collaborator stays, 20 000 to 30 000 ms. */
  readonly timeoutMs?: number;
}

/**
 * What a collab client is built from. Tokens come from exactly one of `getToken` (asked on every
 * connection, so an expired token is replaced) and `token` (fixed, for compatibility).
 */
export interface CollabClientOptions extends BoardTokenOptions {
  /** The board's store: local transactions go out, relayed updates come in. */
  readonly store: DocumentStore;
  /** The board id: the relay's document name; must match the token's `boardId`. */
  readonly boardId: string;
  /**
   * The relay's WebSocket URL, e.g. `wss://relay.example.com`. The client adds the stored
   * layouts it reads as the `layouts` query parameter (the relay's layout gate).
   */
  readonly url: string;
  /**
   * The stored layouts this client declares it reads; default `READABLE_LAYOUT_VERSIONS` of
   * `@canvas/document`, which is what its store reads. Tests pass others to be refused.
   */
  readonly readableLayoutVersions?: readonly number[];
  /** The device's copy of boards; loaded into the store before the first connection. */
  readonly cache?: DocumentCache;
  /**
   * The converters that carry unsent edits over a stored-layout bump, by bump
   * (`layoutStepKey`); `DEFAULT_LAYOUT_CONVERTERS` by default. Used once the first sync is done,
   * when the cache has earlier layouts' copies of the board.
   */
  readonly layoutConverters?: LayoutConverters;
  /** Compact the cached log every this many updates; default 500. */
  readonly compactEvery?: number;
  /** Optional display-only sidecar preparation; caller fences carry-over and renderer eligibility. */
  readonly prepareSnapshotPreview?: () => Promise<Uint8Array | undefined>;
  /** Runs cache compactions when the main thread is idle; default `requestIdleCallback`. */
  readonly idleScheduler?: IdleScheduler;
  /** Lets the browser run other tasks while the cached board is restored; none by default. */
  readonly yieldToBrowser?: () => Promise<void>;
  /** Presence for the local principal; omitted for a client without cursors (a job). */
  readonly presence?: CollabPresenceOptions;
  /** Reconnection spacing; fields left out keep `DEFAULT_RECONNECT_BACKOFF`'s. */
  readonly reconnect?: Partial<ReconnectBackoff>;
  /** Drop a connection that has been silent this long, in ms; default 30 000. */
  readonly idleTimeoutMs?: number;
  /** The clock `lastSyncedAt` and presence read; default `Date.now`. */
  readonly clock?: PresenceClock;
  /**
   * The estimate of the relay's clock to keep: each connection asks the relay's clock
   * when it joins and with each keepalive answer, and feeds the answers to it. Shared timers count
   * down on it. Absent, the client asks nothing.
   */
  readonly serverClock?: ServerClock;
  /**
   * The client's reactions to keep: each authenticated connection is their way out
   * while current, and hands them everyone else's. Absent, the client neither sends nor hears any.
   */
  readonly reactions?: ReactionChannel;
  /** Runs retries, the idle check and presence work; default `setTimeout`. */
  readonly scheduler?: PresenceScheduler;
  /** A uniform random number in [0, 1), for backoff jitter; default `Math.random`. */
  readonly random?: () => number;
  /** Opens connections; default the platform `WebSocket`. Tests pass a fake transport. */
  readonly socketFactory?: CollabSocketFactory;
  /** The device's network signal; default `navigator.onLine` and its events. */
  readonly network?: NetworkStatus;
  /**
   * Receives failures that do not stop the client: a cache that cannot be read or written, a
   * frame that cannot be decoded (the connection is then dropped and resynced). Default:
   * rethrown from a microtask, where the host's error reporting sees it.
   */
  readonly onError?: (error: unknown) => void;
}

/** Where a collab client stands, as the app shows it; a new frozen object on every change. */
export interface CollabStatus {
  /** The connection state. */
  readonly state: ConnectionState;
  /**
   * When the latest handshake or queued outbound updates completed, in ms on the client's
   * clock. This acknowledges integrated history only: unresolved cached fragments may remain
   * locally awaiting dependencies. It does not certify every cached byte is saved remotely.
   * `undefined` until the first completed sync.
   */
  readonly lastSyncedAt: number | undefined;
  /**
   * Outbound local/recovery updates not acknowledged yet (held or in flight). Unresolved
   * cached fragments are retained separately and are not counted as sendable updates.
   */
  readonly pendingUpdateCount: number;
  /** Whether the relay refuses this client's updates (a viewer's or commenter's token). */
  readonly isReadOnly: boolean;
  /**
   * Whether the relay has acknowledged everything this connection holds ('s notion, the
   * one that holds the cache's compactions): connected, this connection's step 2 sent (it
   * carries what the store held, edits restored from the cache included, which are never
   * counted in `pendingUpdateCount`) and every message acknowledged; or connected read-only,
   * whose updates the relay never applies. `false` from `connected` until the relay's
   * acknowledgement of the client's own step 2 arrives, and again whenever a local update is in
   * flight or the connection is not `connected`.
   */
  readonly isAcknowledged: boolean;
  /**
   * Why the client stopped for good: the relay's reason for refusing the token once `state` is
   * `unauthorized`; once it is `outdated`, the layout gate's reason (`unreadable-layout`,
   * `unstamped-write`) or the store's `DocumentVersionError` problem (`unversioned`,
   * `unreadable-version`).
   */
  readonly rejectionReason: string | undefined;
}

/** Receives the client's status after every change. */
export type CollabStatusListener = (status: CollabStatus) => void;
