import {
  systemPresenceClock,
  type PresenceClock,
  type PresenceScheduler,
  type PresenceTimer,
} from '../presence/presence-time.js';

import type { CollabClientOptions } from './collab-client-options.js';
import type { ConnectionTokens, RefreshOutcome } from './connection-tokens.js';
import { encodeTokenRefresh, type TokenLifetimeKind } from './relay-protocol.js';

/** The least time before expiry a refresh is sent, in ms. */
export const REFRESH_MIN_LEAD_MS = 60_000;

/** The share of the remaining lifetime kept as lead when larger than the minimum. */
export const REFRESH_LEAD_FRACTION = 0.2;

/** The most a refresh is brought forward at random, in ms, so a board's clients spread out. */
export const REFRESH_JITTER_MS = 30_000;

/** The shortest wait before a refresh, in ms. */
export const REFRESH_MIN_DELAY_MS = 5_000;

/**
 * The shortest time between two refreshes of one connection, in ms: the relay accepts at most
 * one every 30 s (`token-refresh-limit`), so after an acknowledgement the next waits this long.
 */
export const REFRESH_MIN_INTERVAL_MS = 30_000;

/** A token announced with less left than this is not refreshed (the relay's 4401 follows), ms. */
export const REFRESH_MIN_REMAINING_MS = 15_000;

/** A refresh is not sent with less than this left, since it would race the expiry, in ms. */
export const REFRESH_SEND_DEADLINE_MS = 5_000;

/** The wait before asking the provider again after it failed, in ms. */
export const REFRESH_RETRY_DELAY_MS = 15_000;

/** A failed or stale refresh is retried only with more than this left, in ms. */
export const REFRESH_RETRY_MIN_REMAINING_MS = 30_000;

/** What a {@link TokenRefresher} works with. */
export interface TokenRefresherHost {
  /** Runs the refresh timers. */
  readonly scheduler: PresenceScheduler;
  /** The local clock, in ms; the deadline check reads it. */
  readonly clock: PresenceClock;
  /** A uniform random number in [0, 1), for the jitter. */
  readonly random: () => number;
  /**
   * Asks for a newer token.
   *
   * @param deliver - Receives the outcome.
   */
  fetch(deliver: (outcome: RefreshOutcome) => void): void;
  /**
   * Sends a `token-refresh` with the token.
   *
   * @param token - The token.
   */
  send(token: string): void;
  /**
   * The relay accepted the token sent.
   *
   * @param token - The token.
   */
  onRefreshed(token: string): void;
  /**
   * Reports a failure that does not stop the connection.
   *
   * @param error - The failure.
   */
  report(error: unknown): void;
}

/**
 * The delay before refreshing a token with a remaining lifetime (design section 1): the lifetime
 * less a lead (the larger of {@link REFRESH_MIN_LEAD_MS} and {@link REFRESH_LEAD_FRACTION} of
 * it) less up to {@link REFRESH_JITTER_MS}, and at least {@link REFRESH_MIN_DELAY_MS}. For a
 * fresh 10-minute token, 450 to 480 s.
 *
 * @param expiresInMs - What the token has left, in ms.
 * @param random - A uniform random number in [0, 1).
 * @returns The delay, in ms.
 */
export function refreshDelayMs(expiresInMs: number, random: number): number {
  const leadMs = Math.max(REFRESH_MIN_LEAD_MS, REFRESH_LEAD_FRACTION * expiresInMs);
  return Math.max(REFRESH_MIN_DELAY_MS, expiresInMs - leadMs - random * REFRESH_JITTER_MS);
}

/**
 * Refreshes one connection's board token before it expires. Nothing happens until the relay
 * announces the token's remaining lifetime (`token-expiry`), so on a relay that cannot refresh
 * the connection is closed at expiry as before. It then asks the provider for a newer token at
 * {@link refreshDelayMs}, sends it, and waits for `token-refreshed`, which schedules the next
 * one, at least {@link REFRESH_MIN_INTERVAL_MS} later; at most one refresh is unanswered. A stale token or a provider failure is retried once
 * while time remains; an invalid token is reported and ends refreshing. A refusal is a close,
 * handled by the link as any 4401, 4403 or 1008. A timer that fires late (a sleeping tab) sends
 * nothing within {@link REFRESH_SEND_DEADLINE_MS} of expiry. Main thread or worker.
 */
export class TokenRefresher {
  readonly #host: TokenRefresherHost;
  #timer: PresenceTimer | undefined;
  #expiresAtMs = 0;
  #sent: string | undefined;
  #hasRetried = false;
  #isDisposed = false;

  /**
   * Prepares a refresher; nothing is scheduled until the relay's announcement.
   *
   * @param host - The timers, the clock, the provider and the socket.
   */
  constructor(host: TokenRefresherHost) {
    this.#host = host;
  }

  /**
   * Takes the relay's word on the token: its announcement, or the acknowledgement of the token
   * sent (which then becomes the connection's).
   *
   * @param kind - `token-expiry` or `token-refreshed`.
   * @param expiresInMs - What the token has left by the relay's clock, in ms.
   */
  receive(kind: TokenLifetimeKind, expiresInMs: number): void {
    if (this.#isDisposed) return;
    if (kind === 'token-refreshed') {
      const sent = this.#sent;
      if (sent === undefined) return;
      this.#sent = undefined;
      this.#host.onRefreshed(sent);
      this.#schedule(expiresInMs, REFRESH_MIN_INTERVAL_MS);
    } else if (this.#sent === undefined) {
      this.#schedule(expiresInMs, 0);
    }
  }

  /** Stops for good: no timer runs and no fetch delivers. */
  dispose(): void {
    this.#isDisposed = true;
    this.#timer?.cancel();
    this.#timer = undefined;
  }

  /**
   * Schedules the refresh of a token with a remaining lifetime.
   *
   * @param expiresInMs - What it has left, in ms.
   * @param minDelayMs - The least wait, in ms: {@link REFRESH_MIN_INTERVAL_MS} after a refresh.
   */
  #schedule(expiresInMs: number, minDelayMs: number): void {
    this.#timer?.cancel();
    this.#timer = undefined;
    this.#hasRetried = false;
    this.#expiresAtMs = this.#host.clock.now() + expiresInMs;
    if (expiresInMs < REFRESH_MIN_REMAINING_MS) return;
    this.#after(Math.max(minDelayMs, refreshDelayMs(expiresInMs, this.#host.random())));
  }

  /**
   * Asks for a token after a delay.
   *
   * @param delayMs - The delay, in ms.
   */
  #after(delayMs: number): void {
    this.#timer = this.#host.scheduler.schedule(() => {
      this.#timer = undefined;
      if (this.#remainingMs() < REFRESH_SEND_DEADLINE_MS) return;
      this.#host.fetch((outcome) => {
        this.#onOutcome(outcome);
      });
    }, delayMs);
  }

  /**
   * Acts on what the provider gave.
   *
   * @param outcome - The refresh request's outcome.
   */
  #onOutcome(outcome: RefreshOutcome): void {
    if (this.#isDisposed) return;
    switch (outcome.kind) {
      case 'token':
        if (this.#remainingMs() < REFRESH_SEND_DEADLINE_MS) return;
        this.#sent = outcome.token;
        this.#host.send(outcome.token);
        return;
      case 'stale':
        this.#retry(this.#remainingMs() / 2);
        return;
      case 'failed':
        this.#host.report(outcome.error);
        this.#retry(REFRESH_RETRY_DELAY_MS);
        return;
      case 'invalid':
        this.#host.report(outcome.error);
    }
  }

  /**
   * Asks once more, when it has not already and time remains.
   *
   * @param delayMs - The wait, in ms.
   */
  #retry(delayMs: number): void {
    if (this.#hasRetried || this.#remainingMs() <= REFRESH_RETRY_MIN_REMAINING_MS) return;
    this.#hasRetried = true;
    this.#after(delayMs);
  }

  /**
   * What the token has left by the local clock.
   *
   * @returns The time, in ms.
   */
  #remainingMs(): number {
    return this.#expiresAtMs - this.#host.clock.now();
  }
}

/** The parts of a relay link a connection's refresher is built from. */
export interface RefresherParts {
  /** The client's options: board, clock, random source. */
  readonly options: Pick<CollabClientOptions, 'boardId' | 'clock' | 'random'>;
  /** Runs the timers. */
  readonly scheduler: PresenceScheduler;
  /** The tokens of the link's connections. */
  readonly tokens: ConnectionTokens;
}

/**
 * Builds the refresher of one connection of a relay link: the provider through the link's
 * tokens, the token sent on the connection's socket.
 *
 * @param parts - The link's options, scheduler and tokens.
 * @param sendFrame - Sends a frame on the connection's socket.
 * @param report - Reports a failure (`onError`).
 * @returns The refresher.
 */
export function createLinkRefresher(
  parts: RefresherParts,
  sendFrame: (data: Uint8Array) => void,
  report: (error: unknown) => void,
): TokenRefresher {
  const { options, scheduler, tokens } = parts;
  return new TokenRefresher({
    scheduler,
    clock: options.clock ?? systemPresenceClock,
    random: options.random ?? Math.random,
    fetch: (deliver) => {
      tokens.refresh(deliver);
    },
    send: (token) => {
      tokens.refreshSent(token);
      sendFrame(encodeTokenRefresh(options.boardId, token));
    },
    onRefreshed: (token) => {
      tokens.refreshed(token);
    },
    report,
  });
}
