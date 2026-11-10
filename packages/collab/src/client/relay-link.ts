import { removeAwarenessStates, type Awareness } from 'y-protocols/awareness';

import {
  UpdateDepthError,
  UPDATE_DEPTH_REASON,
  isLayoutGateReason,
  READABLE_LAYOUT_VERSIONS,
  type DocumentStore,
} from '@canvas/document';

import { reportAsynchronously } from '../errors/report-asynchronously.js';
import type { PresenceScheduler, PresenceTimer } from '../presence/presence-time.js';
import { computeReconnectDelay, type ReconnectBackoff } from '../reconnect/reconnect-delay.js';

import type { BoardNoticeKind } from './board-notices.js';
import { DEFAULT_IDLE_TIMEOUT_MS, type CollabClientOptions } from './collab-client-options.js';
import { createWebSocketFactory, type CollabSocket } from './collab-socket.js';
import type { CollabStatusHolder } from './collab-status-holder.js';
import type { ConnectionTokens, TokenOutcome } from './connection-tokens.js';
import { DEMO_BUSY_REASON, DemoBusyNotice } from './demo-busy-notice.js';
import { connectionHostFor } from './link-connection-host.js';
import type { OutboundQueue } from './outbound-queue.js';
import { classifyClose, withReadableLayouts } from './relay-close.js';
import { RelayConnection } from './relay-connection.js';
import { encodeStatelessMessage, RELAY_AWARENESS_ORIGIN } from './relay-protocol.js';
import type { SyncTimer } from './sync-timings.js';
import { createLinkRefresher, type TokenRefresher } from './token-refresher.js';
import { UnsentChangesSplitWarning } from './unsent-changes-split-warning.js';
import { versionErrorIn } from './version-error-in.js';

/** What a {@link RelayLink} works with: its client's parts, and what it reports back. */
export interface RelayLinkHost {
  /** The client's options: URL, transport, idle timeout, random source, `onError`. */
  readonly options: CollabClientOptions;
  /** Runs retries and the idle check. */
  readonly scheduler: PresenceScheduler;
  /** Reconnection spacing. */
  readonly backoff: ReconnectBackoff;
  /** The tokens of the link's connections. */
  readonly tokens: ConnectionTokens;
  /** The client's status, which the link moves. */
  readonly status: CollabStatusHolder;
  /** The board's store. */
  readonly store: DocumentStore;
  /** The awareness presence runs on. */
  readonly awareness: Awareness;
  /** The account of local updates not yet acknowledged. */
  readonly queue: OutboundQueue;
  /** The marks of the client's first sync; the link marks each socket's request. */
  readonly syncTimer: SyncTimer;
  /**
   * Reads the board's stored updates from the client's cache (its current writer layout's log),
   * when it has one that can: a large sync step 2 replays them.
   */
  readonly readStoredUpdates?: () => Promise<readonly Uint8Array[]>;
  /**
   * Applies an update from the relay to the store, marked so it is not sent back.
   *
   * @param update - The update bytes.
   */
  applyRemoteUpdate(update: Uint8Array): void;
  /** The sync position may have moved: records a sync when everything is acknowledged. */
  checkSynced(): void;
  /** Delivers an authenticated board notice: the threads or the vote changed. */
  readonly onNotice?: (kind: BoardNoticeKind) => void;
}

/**
 * A collab client's connection attempts to the relay, one at a time:
 * each attempt gets its token, opens a socket and runs the relay protocol on it. A lost
 * connection (a close, a frame it cannot read, the idle timeout, a provider that fails) is
 * retried with exponential backoff and jitter, reset once both sides acknowledge the initial
 * sync. A refused token is retried once, at once, with a fresh token; a second refusal, or a fresh token equal to
 * the refused one, ends in `unauthorized`. A board this build cannot read ends in `outdated`
 * with no retry: the relay's layout gate closing the socket with 4426, or the store
 * refusing a relayed update with a `DocumentVersionError`, which an early review saw loop as
 * endless reconnections. A close after authentication for a frame past the relay's limit
 * (1009) ends in `outdated` with `update-too-large` too: the frame held one struct
 * too large to split, and
 * resending it would loop. The client decides when attempts start and stop (the network,
 * `disconnect()`). Main thread or worker.
 */
export class RelayLink {
  readonly #host: RelayLinkHost;
  #socket: CollabSocket | undefined;
  #connection: RelayConnection | undefined;
  #refresher: TokenRefresher | undefined;
  #retryTimer: PresenceTimer | undefined;
  #idleTimer: PresenceTimer | undefined;
  #attempt = 0;
  #hasRetriedRefusalAtOnce = false;
  #hasWarnedOfSplit = false;

  /**
   * Prepares the link; nothing is attempted until {@link RelayLink.open}.
   *
   * @param host - The client's parts.
   */
  constructor(host: RelayLinkHost) {
    this.#host = host;
  }

  /**
   * The open connection's protocol, while there is one.
   *
   * @returns The connection, or `undefined` between connections.
   */
  get connection(): RelayConnection | undefined {
    return this.#connection;
  }

  /**
   * Starts one connection attempt: gets its token (at once, or from the provider), then opens
   * the socket. The idle timer covers a provider that never answers.
   */
  open(): void {
    this.#host.status.transition('attempt');
    this.#armIdleTimer();
    this.#host.tokens.request((outcome) => {
      this.#onToken(outcome);
    });
  }

  /** Starts the backoff over, for an attempt the client starts afresh (back online). */
  resetBackoff(): void {
    this.#attempt = 0;
  }

  /** Closes the socket and forgets the connection: in-flight updates are pending again. */
  close(): void {
    const { tokens, queue, awareness, status } = this.#host;
    tokens.cancel();
    this.#retryTimer?.cancel();
    this.#retryTimer = undefined;
    this.#idleTimer?.cancel();
    this.#idleTimer = undefined;
    const socket = this.#socket;
    this.#socket = undefined;
    this.#connection?.dispose();
    this.#connection = undefined;
    this.#refresher?.dispose();
    this.#refresher = undefined;
    socket?.close();
    queue.requeueInFlight();
    const remote = [...awareness.getStates().keys()].filter(
      (clientId) => clientId !== awareness.clientID,
    );
    if (remote.length > 0) removeAwarenessStates(awareness, remote, RELAY_AWARENESS_ORIGIN);
    status.update({ pendingUpdateCount: queue.pendingCount });
  }

  /**
   * Continues an attempt with its token, or ends it: a refused or invalid token is final, a
   * provider failure is a failed attempt, retried with backoff.
   *
   * @param outcome - What the token request ended in.
   */
  #onToken(outcome: TokenOutcome): void {
    switch (outcome.kind) {
      case 'token':
        this.#openSocket(outcome.token);
        return;
      case 'refused':
        this.#stop('rejected', outcome.reason);
        return;
      case 'invalid':
        this.#report(outcome.error);
        this.#stop('rejected', outcome.reason);
        return;
      case 'failed':
        this.#report(outcome.error);
        this.#onLost();
    }
  }

  /**
   * Opens the socket of an attempt.
   *
   * @param token - The board token it authenticates with.
   */
  #openSocket(token: string): void {
    const { options } = this.#host;
    const factory = options.socketFactory ?? createWebSocketFactory();
    const url = withReadableLayouts(
      options.url,
      options.readableLayoutVersions ?? READABLE_LAYOUT_VERSIONS,
    );
    this.#host.syncTimer.markSocketRequested();
    const socket: CollabSocket = factory(url, {
      onOpen: () => {
        if (socket === this.#socket) this.#onOpen(socket, token);
      },
      onMessage: (data) => {
        if (socket === this.#socket) this.#onMessage(socket, data);
      },
      onClose: (code, reason) => {
        if (socket !== this.#socket) return;
        const verdict = classifyClose(code, reason, this.#connection?.isAuthenticated === true);
        if (verdict.kind === 'outdated') this.#stop('outdated', verdict.reason);
        else if (verdict.kind === 'rejected') this.#onRejected(verdict.reason);
        else {
          // A demo board past its visitors' limit: retried, and told to the page.
          if (reason === DEMO_BUSY_REASON) this.#report(new DemoBusyNotice());
          this.#onLost();
        }
      },
    });
    this.#socket = socket;
    this.#armIdleTimer();
  }

  /**
   * Starts the protocol on a socket that opened.
   *
   * @param socket - The socket.
   * @param token - The board token it authenticates with.
   */
  #onOpen(socket: CollabSocket, token: string): void {
    const host = this.#host;
    this.#armIdleTimer();
    const refresher = createLinkRefresher(
      host,
      (data) => {
        socket.send(data);
      },
      (error) => {
        this.#report(error);
      },
    );
    this.#refresher = refresher;
    this.#connection = new RelayConnection(
      connectionHostFor(host, token, {
        report: (error) => {
          this.#report(error);
        },
        onReceiveError: (error) => {
          this.#onReceiveError(socket, error);
        },
        onSplit: () => {
          if (this.#hasWarnedOfSplit) return;
          this.#hasWarnedOfSplit = true;
          this.#report(new UnsentChangesSplitWarning());
        },
        onAcknowledged: () => {
          if (this.#connection?.isSyncAcknowledged !== true) return;
          this.#attempt = 0;
          this.#hasRetriedRefusalAtOnce = false;
        },
        onRejected: (reason) => {
          this.#onRejected(reason);
        },
        onLost: () => {
          this.#onLost();
        },
        isCurrent: () => this.#socket === socket,
        onTokenLifetime: (kind, expiresInMs) => {
          refresher.receive(kind, expiresInMs);
        },
      }),
      (data) => {
        socket.send(data);
      },
    );
    const connection = this.#connection;
    // Reactions go out on this connection while it is current and the relay accepted its token.
    host.options.reactions?.attach((payload) => {
      const isReady = this.#socket === socket && connection.isAuthenticated;
      if (isReady) socket.send(encodeStatelessMessage(host.options.boardId, payload));
      return isReady;
    });
    this.#connection.start();
  }

  /**
   * Hands a frame to the protocol; a frame it cannot handle drops the connection.
   *
   * @param socket - The socket it came on.
   * @param data - The frame.
   */
  #onMessage(socket: CollabSocket, data: Uint8Array): void {
    this.#armIdleTimer();
    try {
      this.#connection?.receive(data);
    } catch (error: unknown) {
      this.#onReceiveError(socket, error);
    }
  }

  /**
   * Drops the connection over a frame the protocol could not handle, now or once released from
   * the inbound hold: an outdated board stops the link, anything else reconnects.
   *
   * @param socket - The socket the frame came on.
   * @param error - The failure.
   */
  #onReceiveError(socket: CollabSocket, error: unknown): void {
    if (error instanceof UpdateDepthError && socket === this.#socket) {
      this.#stop('outdated', UPDATE_DEPTH_REASON);
      return;
    }
    const versionError = versionErrorIn(error);
    // The store cannot read the board: reconnecting would only fetch it again.
    if (versionError !== undefined && socket === this.#socket) {
      this.#stop('outdated', versionError.problem);
      return;
    }
    this.#report(error);
    if (socket === this.#socket) this.#onLost();
  }

  /**
   * Tears down a lost connection and schedules the next attempt. Only a live attempt's events,
   * its idle timer and a repeated refusal call it, and going offline or unauthorized closes the
   * attempt first, so it never runs in those states.
   */
  #onLost(): void {
    const { options, scheduler, backoff, status } = this.#host;
    this.close();
    status.transition('lost');
    const delayMs = computeReconnectDelay(
      this.#attempt,
      backoff,
      (options.random ?? Math.random)(),
    );
    this.#attempt += 1;
    this.#retryTimer = scheduler.schedule(() => {
      this.#retryTimer = undefined;
      this.open();
    }, delayMs);
  }

  /**
   * Handles a refused token: the first refusal since a token was accepted is retried with a
   * fresh token (the old one may simply have expired while the client was away); a second one
   * is final. Only the first such retry since the last sync is immediate: a relay that accepts
   * every fresh token and then closes with 4401 would otherwise be asked again at once, forever,
   * so later ones wait the normal backoff.
   *
   * @param reason - The relay's reason.
   */
  #onRejected(reason: string): void {
    if (isLayoutGateReason(reason)) {
      this.#stop('outdated', reason);
      return;
    }
    this.close();
    if (!this.#host.tokens.retryAfterRefusal(reason)) {
      this.#stop('rejected', reason);
      return;
    }
    if (this.#hasRetriedRefusalAtOnce) {
      this.#onLost();
      return;
    }
    this.#hasRetriedRefusalAtOnce = true;
    // A refusal on the first connection is refreshed within the same attempt: the app sees
    // `connecting` turn into `connected` or `unauthorized`, never a passing `reconnecting`
    // (which it would read as an unreachable relay).
    if (this.#host.status.current.state !== 'connecting') this.#host.status.transition('lost');
    this.open();
  }

  /**
   * Stops for good: the relay refused the token and a fresh one cannot help (`rejected`), or this
   * build cannot read the board (`outdated`: nothing more is sent; local edits stay in the store
   * and the cache).
   *
   * @param event - `rejected` or `outdated`.
   * @param reason - The relay's reason, the gate's, or the store's version problem.
   */
  #stop(event: 'rejected' | 'outdated', reason: string): void {
    this.#host.status.update({ rejectionReason: reason });
    this.#host.status.transition(event);
    this.close();
  }

  /** (Re)starts the idle check: an attempt or connection silent for the timeout is dropped. */
  #armIdleTimer(): void {
    this.#idleTimer?.cancel();
    this.#idleTimer = this.#host.scheduler.schedule(() => {
      this.#idleTimer = undefined;
      this.#onLost();
    }, this.#host.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
  }

  /**
   * Hands a failure that does not stop the client to `onError`.
   *
   * @param error - The failure.
   */
  #report(error: unknown): void {
    (this.#host.options.onError ?? reportAsynchronously)(error);
  }
}
