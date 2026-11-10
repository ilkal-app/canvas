import { YjsDocumentStore } from '@canvas/document';

import { ManualTime } from '../../presence/__fixtures__/manual-time.js';
import type { CollabClientOptions } from '../collab-client-options.js';
import type { CollabClient } from '../collab-client.js';
import { createCollabClient } from '../create-collab-client.js';
import type { NetworkStatus } from '../network-status.js';

import { FakeRelay } from './fake-relay.js';
import { EDITOR_CLAIMS, unsignedToken } from './unsigned-token.js';

/** The board every harness client opens. */
export const BOARD = EDITOR_CLAIMS.boardId;

/** A network signal the test flips. */
export class FakeNetwork implements NetworkStatus {
  #isOnline = true;
  readonly #listeners = new Set<(isOnline: boolean) => void>();

  /** @inheritdoc */
  isOnline(): boolean {
    return this.#isOnline;
  }

  /** @inheritdoc */
  subscribe(listener: (isOnline: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Changes the signal and tells the listeners.
   *
   * @param isOnline - The new state.
   */
  set(isOnline: boolean): void {
    this.#isOnline = isOnline;
    for (const listener of this.#listeners) listener(isOnline);
  }
}

/** A fake relay, a frozen clock and a network signal that every client in a test shares. */
export class ClientHarness {
  /** The relay. */
  readonly relay = new FakeRelay();
  /** The clock and scheduler. */
  readonly time = new ManualTime();
  /** The network signal. */
  readonly network = new FakeNetwork();
  /** Every client opened, for teardown. */
  readonly clients: CollabClient[] = [];

  /**
   * Creates a client over a new store with the harness's relay, time and network, a fixed
   * random value (so backoff is exact) and an editor's fixed token unless `overrides` give a
   * `getToken`; `overrides` replace any option.
   *
   * @param overrides - Options to replace.
   * @returns The client; nothing has been delivered yet.
   */
  async open(overrides: Partial<CollabClientOptions> = {}): Promise<CollabClient> {
    const client = await createCollabClient({
      store: new YjsDocumentStore(),
      boardId: BOARD,
      url: 'ws://relay.test',
      ...(overrides.getToken === undefined ? { token: unsignedToken(EDITOR_CLAIMS) } : {}),
      clock: this.time,
      scheduler: this.time,
      idleScheduler: this.time,
      random: () => 0,
      socketFactory: this.relay.socketFactory,
      network: this.network,
      ...overrides,
    });
    this.clients.push(client);
    return client;
  }

  /**
   * Creates a client and delivers everything, so it is connected and synced.
   *
   * @param overrides - Options to replace.
   * @returns The connected client.
   */
  async connect(overrides: Partial<CollabClientOptions> = {}): Promise<CollabClient> {
    const client = await this.open(overrides);
    this.relay.run();
    return client;
  }

  /**
   * Moves time forward and delivers everything that follows.
   *
   * @param durationMs - How far, in ms.
   */
  advance(durationMs: number): void {
    this.time.advanceBy(durationMs);
    this.relay.run();
  }

  /**
   * Delivers everything, including what waits on promises (a token provider's answer), until
   * nothing moves.
   */
  async settle(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
      this.relay.run();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    this.relay.run();
  }

  /**
   * Moves time forward, then delivers everything that follows, promises included.
   *
   * @param durationMs - How far, in ms.
   */
  async advanceAndSettle(durationMs: number): Promise<void> {
    this.time.advanceBy(durationMs);
    await this.settle();
  }

  /** Destroys every client. */
  destroy(): void {
    for (const client of this.clients.splice(0)) client.destroy();
    this.relay.run();
  }
}
