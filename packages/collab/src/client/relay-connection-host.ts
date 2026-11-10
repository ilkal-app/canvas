import type { Awareness } from 'y-protocols/awareness';

import type { DocumentStore } from '@canvas/document';

import type { ServerClock } from '../clock/server-clock.js';
import type { ReactionChannel } from '../presence/reaction-channel.js';

import type { OutboundQueue } from './outbound-queue.js';
import type { RelayConnection } from './relay-connection.js';
import type { TokenLifetimeKind } from './relay-protocol.js';
import type { SyncTimer } from './sync-timings.js';

/** What a {@link RelayConnection} needs from the client that owns it, and reports back. */
export interface RelayConnectionHost {
  /** The board id: the relay's document name. */
  readonly documentName: string;
  /** The board token. */
  readonly token: string;
  /** The board's store: its state vector and diffs go out, relayed updates come in. */
  readonly store: DocumentStore;
  /** The awareness instance presence runs on. */
  readonly awareness: Awareness;
  /** The account of local updates not yet acknowledged; outlives the connection. */
  readonly queue: OutboundQueue;
  /**
   * The marks of the client's first sync: the connection marks the relay's
   * `authenticated` and the arrival of its sync step 2, before the step 2 is applied.
   */
  readonly syncTimer?: SyncTimer;
  /**
   * Reads the board's stored updates (the cache's log, oldest first), when the client has a
   * cache that can: a sync step 2 larger than one chunk replays them.
   */
  readonly readStoredUpdates?: () => Promise<readonly Uint8Array[]>;
  /**
   * Reports a failure that does not stop the connection (the stored updates could not be read
   * or replayed, so the step 2 was split by struct ranges instead).
   *
   * @param error - The failure.
   */
  readonly reportError: (error: unknown) => void;
  /**
   * A relayed update held for a stepped run could not be applied once released: the
   * owner drops the connection, as for a frame it cannot handle. Absent, it is reported.
   *
   * @param error - The failure.
   */
  readonly onReceiveError?: (error: unknown) => void;
  /**
   * Something goes split by struct ranges, so peers may see part of a transaction: a step 2
   * larger than one chunk that could be replayed neither from memory nor from the cache's log
   * (a cache an older build compacted with unsent work in it, an unreadable log, a cache without
   * `readUpdates`), or a single transaction above `SINGLE_TRANSACTION_BYTES`. The owner warns
   * once (`UnsentChangesSplitWarning`).
   */
  readonly onStructRangeSplit: () => void;
  /**
   * Applies an update from the relay to the store, marked so it is not sent back.
   *
   * @param update - The update bytes.
   */
  applyRemoteUpdate(update: Uint8Array): void;
  /**
   * The relay accepted the token.
   *
   * @param isReadOnly - Whether the relay refuses this connection's updates (viewers,
   *   commenters).
   */
  onAuthenticated(isReadOnly: boolean): void;
  /** The relay's state arrived (sync step 2): the first sync of this connection is done. */
  onSynced(): void;
  /** An acknowledgement or a relayed update arrived: the sync position may have moved. */
  onProgress(): void;
  /**
   * The relay refused the token.
   *
   * @param reason - The relay's reason (`expired`, `bad-signature`, `wrong-board`, ...).
   */
  onRejected(reason: string): void;
  /** The relay closed this board's connection. */
  onClosedByRelay(): void;
  /** A board-scoped comment invalidation from the relay. */
  readonly onThreadsChanged?: () => void;
  /** A board-scoped vote invalidation from the relay. */
  readonly onVotesChanged?: () => void;
  /** What the token has left by the relay's clock, in ms: on joining, after a refresh. */
  readonly onTokenLifetime?: (kind: TokenLifetimeKind, expiresInMs: number) => void;
  /**
   * The client's estimate of the relay's clock: the connection asks the relay's clock
   * when it joins and with each keepalive answer, and hands it each answer.
   */
  readonly serverClock?: ServerClock;
  /** The client's reactions: the connection hands it everyone else's. */
  readonly reactions?: ReactionChannel;
}
