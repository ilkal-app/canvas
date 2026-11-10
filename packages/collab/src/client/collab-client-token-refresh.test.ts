import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import { RELAY_MESSAGE_TYPES } from './relay-protocol.js';
import type { BoardTokenRequest } from './token-source.js';

// A collab client refreshing its token on the open connection, against the fake relay
// on manual time: it stays connected across its old token's expiry with one socket and no
// resync; an older relay (no announcement) gets today's reconnect; refusals take the 4401 /
// 4403 path; going offline and a fixed token never refresh.

const LIFETIME_MS = 600_000;
const FIRST_REFRESH_MS = 480_000;

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * A distinct editor's token for `board-1`, each expiring later than the one before.
 *
 * @param issue - Which issue.
 * @returns The token.
 */
function tokenNumber(issue: number): string {
  return unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_000 + issue * 600 });
}

/**
 * A provider handing out tokens 1, 2, 3, ... and recording every request.
 *
 * @returns The provider and its requests.
 */
function countingProvider(): {
  getToken: (request?: BoardTokenRequest) => Promise<string>;
  requests: (BoardTokenRequest | undefined)[];
} {
  const requests: (BoardTokenRequest | undefined)[] = [];
  const getToken = vi.fn((request?: BoardTokenRequest) => {
    requests.push(request);
    return Promise.resolve(tokenNumber(requests.length));
  });
  return { getToken, requests };
}

/**
 * A harness whose relay announces 10-minute tokens, or nothing as an older relay.
 *
 * @param isOlderRelay - Whether the relay predates refresh (announces nothing).
 * @returns The harness.
 */
function setUp(isOlderRelay = false): ClientHarness {
  harness = new ClientHarness();
  harness.relay.announcedExpiryMs = isOlderRelay ? undefined : LIFETIME_MS;
  return harness;
}

describe('a client on a relay that refreshes tokens', () => {
  it('stays connected across its old token expiry, with one socket and no resync', async () => {
    const { relay } = setUp();
    const { getToken, requests } = countingProvider();
    const client = await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    expect(client.status.state).toBe('connected');
    const syncBytes = relay.syncBytesOn(1);
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    expect(requests.at(-1)).toEqual({ isAfterRefusal: false, isRefresh: true });
    expect(relay.refreshTokens).toEqual([tokenNumber(2)]);
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    expect(relay.refreshTokens).toEqual([tokenNumber(2), tokenNumber(3)]);
    expect(relay.openedUrls).toHaveLength(1);
    expect(relay.syncBytesOn(1)).toBe(syncBytes);
    expect(client.status.state).toBe('connected');
  });

  it('reconnects with a fresh token when the relay refuses the refresh', async () => {
    const { relay } = setUp();
    relay.refreshPolicy = 'refuse';
    const { getToken, requests } = countingProvider();
    const client = await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    expect(relay.refreshTokens).toEqual([tokenNumber(2)]);
    expect(requests.at(-1)).toEqual({ isAfterRefusal: true });
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(3)]);
    expect(client.status.state).toBe('connected');
  });

  it('reconnects with a fresh token when a refresh closes 4403 access-changed', async () => {
    const { relay } = setUp();
    relay.refreshPolicy = 'access-changed';
    const { getToken, requests } = countingProvider();
    const client = await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    expect(requests.at(-1)).toEqual({ isAfterRefusal: true });
    expect(relay.openedUrls).toHaveLength(2);
    expect(client.status.state).toBe('connected');
  });

  it('sends one refresh and waits when the relay never acknowledges it', async () => {
    const { relay } = setUp();
    relay.refreshPolicy = 'ignore';
    const { getToken } = countingProvider();
    await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    await harness.advanceAndSettle(2 * LIFETIME_MS);
    expect(relay.refreshTokens).toEqual([tokenNumber(2)]);
  });

  it('reports a provider that fails the refresh, then reconnects at expiry as before', async () => {
    const { relay } = setUp();
    const failure = new Error('boards service unavailable');
    const requests: (BoardTokenRequest | undefined)[] = [];
    const getToken = (request?: BoardTokenRequest): Promise<string> => {
      requests.push(request);
      if (request?.isRefresh === true) return Promise.reject(failure);
      return Promise.resolve(tokenNumber(requests.length));
    };
    const errors: unknown[] = [];
    const client = await harness.open({
      getToken,
      idleTimeoutMs: 10 * LIFETIME_MS,
      onError: (error) => errors.push(error),
    });
    await harness.settle();
    await harness.advanceAndSettle(FIRST_REFRESH_MS);
    expect(errors).toEqual([failure]);
    // One retry 15 s later, reported too; then the client waits for the relay.
    await harness.advanceAndSettle(15_000);
    expect(errors).toEqual([failure, failure]);
    expect(relay.refreshTokens).toEqual([]);
    expect(client.status.state).toBe('connected');
    relay.drop(4401, 'token-expired');
    await harness.settle();
    expect(requests.at(-1)).toEqual({ isAfterRefusal: true });
    expect(relay.openedUrls).toHaveLength(2);
    expect(client.status.state).toBe('connected');
  });

  it('cancels a pending refresh when the device goes offline', async () => {
    const { relay, network } = setUp();
    const { getToken, requests } = countingProvider();
    const client = await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    network.set(false);
    await harness.advanceAndSettle(LIFETIME_MS);
    expect(client.status.state).toBe('offline');
    expect(requests.some((request) => request?.isRefresh === true)).toBe(false);
    expect(relay.refreshTokens).toEqual([]);
  });

  it('never refreshes a fixed token', async () => {
    const { relay } = setUp();
    await harness.open({ idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    await harness.advanceAndSettle(LIFETIME_MS);
    expect(relay.refreshTokens).toEqual([]);
  });
});

describe("the relay's keepalive", () => {
  it('is answered at once, and keeps a quiet connection from going idle', async () => {
    const { relay } = setUp();
    const client = await harness.open({ idleTimeoutMs: 30_000 });
    await harness.settle();
    const keepalive = (name: string): Uint8Array => {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, name);
      encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES.stateless);
      encoding.writeVarString(encoder, '{"type":"keepalive"}');
      return encoding.toUint8Array(encoder);
    };
    for (let beat = 0; beat < 8; beat += 1) {
      await harness.advanceAndSettle(15_000);
      relay.sendToAll(keepalive);
      relay.run();
    }
    expect(relay.keepaliveAnswers).toBe(8);
    expect(relay.openedUrls).toHaveLength(1);
    expect(client.status.state).toBe('connected');
  });
});

describe('a client on an older relay', () => {
  it('never refreshes, and is reconnected at expiry as before', async () => {
    const { relay } = setUp(true);
    const { getToken, requests } = countingProvider();
    const client = await harness.open({ getToken, idleTimeoutMs: 10 * LIFETIME_MS });
    await harness.settle();
    await harness.advanceAndSettle(LIFETIME_MS);
    expect(relay.refreshTokens).toEqual([]);
    expect(requests).toHaveLength(1);
    relay.drop(4401, 'token-expired');
    await harness.settle();
    expect(requests.at(-1)).toEqual({ isAfterRefusal: true });
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
    expect(client.status.state).toBe('connected');
  });
});
