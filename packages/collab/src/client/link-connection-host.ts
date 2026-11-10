import type { Awareness } from 'y-protocols/awareness';

import type { DocumentStore } from '@canvas/document';

import type { BoardNoticeKind } from './board-notices.js';
import { decodeBoardToken } from './board-token.js';
import type { CollabClientOptions } from './collab-client-options.js';
import type { CollabStatusHolder } from './collab-status-holder.js';
import type { ConnectionTokens } from './connection-tokens.js';
import { whenWritable } from './inbound-hold.js';
import type { OutboundQueue } from './outbound-queue.js';
import type { RelayConnectionHost } from './relay-connection-host.js';
import type { TokenLifetimeKind } from './relay-protocol.js';
import { repairModeFor } from './repair-mode-for.js';
import type { SyncTimer } from './sync-timings.js';

/** The parts of a relay link's client a connection's host is made of (`RelayLinkHost`). */
export interface LinkHostParts {
  /** The client's options; the board id names the relay's document. */
  readonly options: CollabClientOptions;
  /** The tokens of the link's connections. */
  readonly tokens: ConnectionTokens;
  /** The client's status. */
  readonly status: CollabStatusHolder;
  /** The board's store. */
  readonly store: DocumentStore;
  /** The awareness presence runs on. */
  readonly awareness: Awareness;
  /** The account of local updates not yet acknowledged. */
  readonly queue: OutboundQueue;
  /** The marks of the client's first sync. */
  readonly syncTimer: SyncTimer;
  /** Reads the board's stored updates from the client's cache, when it can. */
  readonly readStoredUpdates?: () => Promise<readonly Uint8Array[]>;
  /** Applies an update from the relay to the store. */
  applyRemoteUpdate(update: Uint8Array): void;
  /** Records a sync when everything is acknowledged. */
  checkSynced(): void;
  /** Delivers an authenticated board notice: the threads or the vote changed. */
  readonly onNotice?: (kind: BoardNoticeKind) => void;
}

/** What the link itself does for one connection. */
export interface LinkCallbacks {
  /** Reports an error to the client. */
  readonly report: (error: unknown) => void;
  /** A relayed update released from the inbound hold could not be applied. */
  readonly onReceiveError: (error: unknown) => void;
  /** Something went split by struct ranges; the link warns once. */
  readonly onSplit: () => void;
  /** The sync moved; the link resets its retry spacing once both sides acknowledged it. */
  readonly onAcknowledged: () => void;
  /** The relay refused the connection. */
  readonly onRejected: (reason: string) => void;
  /** The relay closed it. */
  readonly onLost: () => void;
  /**
   * Whether this connection is still the link's current one: a deferred repair-mode switch of a
   * connection since replaced does nothing.
   */
  readonly isCurrent: () => boolean;
  /** The relay told the token's lifetime. */
  readonly onTokenLifetime: (kind: TokenLifetimeKind, expiresInMs: number) => void;
}

/**
 * The host of one relay connection: the client's parts, and the link's callbacks. Authentication
 * switches the store's repair mode once no stepped run holds the store (the switch can
 * write repairs); the status changes at once.
 *
 * @param host - The client's parts.
 * @param token - The board token the connection authenticates with.
 * @param link - What the link does.
 * @returns The host.
 */
export function connectionHostFor(
  host: LinkHostParts,
  token: string,
  link: LinkCallbacks,
): RelayConnectionHost {
  return {
    documentName: host.options.boardId,
    token,
    store: host.store,
    awareness: host.awareness,
    queue: host.queue,
    syncTimer: host.syncTimer,
    ...(host.readStoredUpdates === undefined ? {} : { readStoredUpdates: host.readStoredUpdates }),
    reportError: link.report,
    onReceiveError: link.onReceiveError,
    onStructRangeSplit: link.onSplit,
    applyRemoteUpdate: (update) => {
      host.applyRemoteUpdate(update);
    },
    onAuthenticated: (isReadOnly) => {
      const mode = repairModeFor(decodeBoardToken(token), isReadOnly);
      whenWritable(host.store, () => {
        if (link.isCurrent()) host.store.setRepairMode(mode);
      });
      host.queue.keepBytes(!isReadOnly);
      host.tokens.accepted();
      host.status.update({ isReadOnly });
    },
    onSynced: () => {
      link.onAcknowledged();
      host.status.transition('synced');
      host.checkSynced();
    },
    onProgress: () => {
      link.onAcknowledged();
      host.checkSynced();
    },
    onRejected: link.onRejected,
    onClosedByRelay: link.onLost,
    onThreadsChanged: () => host.onNotice?.('threads'),
    onVotesChanged: () => host.onNotice?.('votes'),
    onTokenLifetime: link.onTokenLifetime,
    ...(host.options.serverClock === undefined ? {} : { serverClock: host.options.serverClock }),
    ...(host.options.reactions === undefined ? {} : { reactions: host.options.reactions }),
  };
}
