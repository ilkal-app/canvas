import type {
  BoardCacheWrites,
  CacheRecovery,
  CollabClient,
  LayoutCarryOver,
  LocalPresence,
  PresenceChannel,
  PresenceCursor,
  PresenceEditing,
  PresenceSnapshot,
  PresenceSpotlight,
  PresenceViewport,
  ReactionChannel,
  ServerClock,
} from '@canvas/collab';
import type { DocumentStore, TransactionOrigin } from '@canvas/document';

import type { PageImages } from '../assets/page-images.js';

import type { BoardConnectionStatus } from './board-connection-status.js';
/** Read-only recovery status and export; retained bytes cannot be dismissed. */
export type BoardRecoverySource = Pick<CacheRecovery, 'state' | 'subscribe' | 'exportSources'>;

/**
 * The shell's board and its link to the relay: the store the engine's
 * document side edits, the origin the local user's commands carry, and where the board stands.
 * Either synced (a collab client keeps the store and the relay's board in step) or local-only
 * (no relay configured or reachable; the demo board on this device). Main thread.
 */
export interface BoardConnection {
  /** Retained device content and its non-destructive export, when recovery is needed. */
  readonly recovery?: BoardRecoverySource | undefined;
  /**
   * The device cache's pending writes, while which the shell holds a reload
   * (`useHoldReloadWhileSaving`). Absent for a board with no device cache.
   */
  readonly cacheWrites?: BoardCacheWrites | undefined;
  /** The board's document: the store the shell mounts the engine with. */
  readonly store: DocumentStore;
  /** Who the local user's commands are attributed to: `user:<sub>` from the token. */
  readonly origin: TransactionOrigin;
  /**
   * The board's images: its assets service and the reader's tokens, the uploads, and
   * the board a copy names. Absent for a connection made without them (tests, the SDK's own).
   */
  readonly images?: PageImages;
  /**
   * Where the board stands.
   *
   * @returns The status; the same object until something changes.
   */
  status(): BoardConnectionStatus;
  /**
   * Calls `listener` after every change of {@link BoardConnection.status}.
   *
   * @param listener - Called with no arguments; read the status.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Drops edits that could not be carried over a layout bump: deletes the records of
   * that earlier copy of the board the carry-over read and removes it from {@link BoardConnection.status}; nothing where
   * there is none (a connection without a device cache).
   *
   * @param source - Where the stranded edits are kept (`StrandedEdits.source`).
   */
  dismissStrandedEdits(source: string): void;
  /** Subscribes to relational comment invalidations, when connected to a relay. */
  onThreadsChanged?(listener: () => void): () => void;
  /** Subscribes to the board's dot-vote invalidations, when connected to a relay. */
  onVotesChanged?(listener: () => void): () => void;
  /**
   * The relay's clock as this device estimates it: shared timers count down on it.
   * Absent on a board with no relay (a local board), where the device's own clock serves.
   */
  readonly serverClock?: Pick<ServerClock, 'now'> | undefined;
  /**
   * The board's reactions: the person's drops out to everyone else, and theirs in.
   * Absent on a board with no relay (a local board), where there is no one to react to.
   */
  readonly reactions?: Pick<ReactionChannel, 'send' | 'subscribe'> | undefined;
  /**
   * Asks the connection to reconnect at once (the offline banner's Retry now), without
   * waiting for the next retry its backoff set; nothing while the device is offline or the relay
   * refused it for good. Absent on a connection that never reconnects (a local-only board).
   */
  retryNow?(): void;
  /**
   * Who else is on the board now, by awareness client id, with the writer ids the relay vouches
   * for, for the undo notice to name who changed something since. Absent where there is
   * no presence (a local board).
   *
   * @returns The remote presence snapshot.
   */
  remotePresence?(): PresenceSnapshot;
  /**
   * This client and its own presence (its page and any spotlight it shares), or
   * `undefined` where there is no presence (a local board).
   *
   * @returns The awareness client id and the local presence.
   */
  localPresence?(): LocalPresence | undefined;
  /**
   * Shares a spotlight (everyone else follows this person's view), or ends it; nothing
   * where there is no presence. The relay drops a viewer's or commenter's.
   *
   * @param spotlight - The spotlight, or `null` to end it.
   */
  showSpotlight?(spotlight: PresenceSpotlight | null): void;
  /**
   * Tells collaborators whom this person follows (presence `following`), or that they
   * follow nobody; nothing where there is no presence.
   *
   * @param principalId - Who, or `null`.
   */
  showFollowing?(principalId: string | null): void;
  /**
   * Tells collaborators which page this person shows (presence `page`); nothing where
   * there is no presence (a local board).
   *
   * @param pageId - The page shown.
   */
  showPage?(pageId: string): void;
  /**
   * Tells collaborators which text this person edits and where their caret or selection is
   * (presence `editing`), or that they stopped; nothing where there is no presence.
   *
   * @param editing - The object and offsets, or `null` when editing stopped.
   */
  showEditing?(editing: PresenceEditing | null): void;
  /**
   * Tells collaborators which part of the board this person's screen shows (presence `viewport`,
   * Their minimaps draw it), or that it shows none; nothing where there is no presence.
   *
   * @param viewport - The region in world units with the zoom, or `null`.
   */
  showViewport?(viewport: PresenceViewport | null): void;
  /**
   * Tells collaborators where this person's pointer is on the board (presence `cursor`,
   * item 10: their cursor layers draw it), or that it left the board; nothing where there is no
   * presence. Presence sends within its rate, so every pointer move may set it.
   *
   * @param cursor - The pointer in world units, or `null`.
   */
  showCursor?(cursor: PresenceCursor | null): void;
  /**
   * Tells collaborators which objects this person selects (presence `selection`, ids only, never
   * persisted; item 14: their boards outline them), or that they select nothing; nothing
   * where there is no presence. Presence keeps the first 1,000 ids.
   *
   * @param ids - The selected ids, or `null` for none.
   */
  showSelection?(ids: readonly string[] | null): void;
  /**
   * Stops syncing for good while the store stays readable (a session that ended while
   * the board was open): the link to the relay closes, nothing reconnects, no token is asked
   * for and nothing more arrives; the device's cache keeps what it holds. Absent on a
   * connection that never syncs (a local-only board).
   */
  stopSyncing?(): void;
  /** Stops syncing and releases the store. */
  destroy(): void;
}

/**
 * What the top bars and the shell's hooks read: a connection's status and its changes, and the
 * offline banner's Retry now when the connection can reconnect.
 */
export type ConnectionStatusSource = Pick<BoardConnection, 'status' | 'subscribe' | 'retryNow'>;

/**
 * The part of a `CollabClient` a synced board connection uses; tests pass a fake.
 */
export type BoardSyncClient = Partial<
  Pick<
    CollabClient,
    'onThreadsChanged' | 'onVotesChanged' | 'connect' | 'disconnect' | 'cacheWrites'
  >
> &
  Pick<CollabClient, 'status' | 'subscribe' | 'destroy' | 'claims'> & {
    /** Remote presence, when the client was asked for it. */
    readonly presence:
      | (Pick<PresenceChannel, 'getRemote' | 'subscribe'> &
          Partial<Pick<PresenceChannel, 'setLocal' | 'getLocal' | 'clientId'>>)
      | undefined;
    /** The layout carry-over, when the client has a cache with earlier layouts. */
    readonly layoutCarryOver:
      (StrandedEditsSource & Partial<Pick<LayoutCarryOver, 'run'>>) | undefined;
    /** Optional retained-cache recovery. */
    readonly recovery?: BoardRecoverySource | undefined;
  };

/** Where a connection reads the edits a layout bump stranded, and dismisses them. */
export type StrandedEditsSource = Pick<LayoutCarryOver, 'stranded' | 'subscribe' | 'dismiss'>;
