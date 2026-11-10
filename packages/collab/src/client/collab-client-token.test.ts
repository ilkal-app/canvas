import { afterEach, describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { computeReconnectDelay, DEFAULT_RECONNECT_BACKOFF } from '../reconnect/reconnect-delay.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';
import type { ConnectionState } from './connection-state.js';
import { createCollabClient } from './create-collab-client.js';
import type { BoardTokenRequest } from './token-source.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

function setUp(): ClientHarness {
  harness = new ClientHarness();
  return harness;
}

/**
 * A distinct editor's token for `board-1`: the n-th token the backend issued.
 *
 * @param issue - Which issue; each is a different token.
 * @returns The token.
 */
function tokenNumber(issue: number): string {
  return unsignedToken({ ...EDITOR_CLAIMS, exp: 2_000_000_000 + issue });
}

/**
 * A provider handing out the given tokens in order, then the last one again.
 *
 * @param tokens - The tokens.
 * @returns The provider, a spy.
 */
function providerOf(...tokens: string[]): ReturnType<typeof vi.fn<() => Promise<string>>> {
  let calls = 0;
  return vi.fn(() => {
    const token = tokens[Math.min(calls, tokens.length - 1)] ?? '';
    calls += 1;
    return Promise.resolve(token);
  });
}

describe('CollabClient token provider', () => {
  it('asks the provider for a fresh token on the first connection and every reconnection', async () => {
    const { relay } = setUp();
    const getToken = providerOf(tokenNumber(1), tokenNumber(2), tokenNumber(3));
    const client = await harness.open({ getToken });
    await harness.settle();
    expect(client.status.state).toBe('connected');
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(client.status.state).toBe('connected');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
  });

  it('reconnects with a refreshed token after the old one expired between connects', async () => {
    const { relay } = setUp();
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), tokenNumber(2)),
    });
    await harness.settle();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(client.status.state).toBe('connected');
    expect(client.status.rejectionReason).toBeUndefined();
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
  });

  it('retries once at once with a fresh token when the relay refuses the current one', async () => {
    const { relay } = setUp();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    const states: ConnectionState[] = [];
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), tokenNumber(2)),
    });
    client.subscribe((status) => states.push(status.state));
    await harness.settle();
    expect(client.status.state).toBe('connected');
    expect(states).not.toContain('unauthorized');
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
  });

  it('stays connecting while a refused first token is refreshed, so the app sees one outcome', async () => {
    const { relay } = setUp();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    const states: ConnectionState[] = [];
    const client = await harness.open({ getToken: providerOf(tokenNumber(1)) });
    client.subscribe((status) => states.push(status.state));
    await harness.settle();
    expect(states).not.toContain('reconnecting');
    expect(states.at(-1)).toBe('unauthorized');
  });

  it('treats a 4401 or 4403 close like a refusal: one retry with a fresh token', async () => {
    const { relay } = setUp();
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), tokenNumber(2)),
    });
    await harness.settle();
    relay.drop(4401, 'Unauthorized');
    await harness.settle();
    expect(client.status.state).toBe('connected');
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
  });

  it('tells the provider a request follows a refusal, even a 4403 while still connecting', async () => {
    const { relay } = setUp();
    relay.closeAfterAuth = { code: 4403, reason: 'access-changed' };
    const tokens = [tokenNumber(1), tokenNumber(2)];
    const statesAtRequest: (ConnectionState | undefined)[] = [];
    const opened: { client?: Awaited<ReturnType<typeof harness.open>> } = {};
    const getToken = vi.fn((request?: BoardTokenRequest) => {
      statesAtRequest.push(opened.client?.status.state);
      if (request?.isAfterRefusal === true) relay.closeAfterAuth = undefined;
      return Promise.resolve(tokens[getToken.mock.calls.length - 1] ?? '');
    });
    const client = await harness.open({ getToken });
    opened.client = client;
    await harness.settle();
    expect(getToken.mock.calls).toEqual([[{ isAfterRefusal: false }], [{ isAfterRefusal: true }]]);
    // The first call makes the client; the refusal came while the first attempt was connecting.
    expect(statesAtRequest).toEqual([undefined, 'connecting']);
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
    expect(client.status.state).toBe('connected');
  });

  it('says a request follows no refusal once a later token was accepted', async () => {
    const { relay } = setUp();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    let issued = 0;
    const getToken = vi.fn<(request?: BoardTokenRequest) => Promise<string>>(() => {
      issued += 1;
      return Promise.resolve(tokenNumber(issued));
    });
    const client = await harness.open({ getToken });
    await harness.settle();
    expect(client.status.state).toBe('connected');
    // The first token was refused and the second accepted: a plain drop after that is no refusal.
    relay.drop(1006, 'dropped');
    await harness.advanceAndSettle(1_000);
    expect(client.status.state).toBe('connected');
    expect(getToken.mock.calls).toEqual([
      [{ isAfterRefusal: false }],
      [{ isAfterRefusal: true }],
      [{ isAfterRefusal: false }],
    ]);
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2), tokenNumber(3)]);
  });

  it('stays unauthorized when the refresh returns the token just refused', async () => {
    const { relay } = setUp();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    const getToken = providerOf(tokenNumber(1));
    const client = await harness.open({ getToken });
    await harness.settle();
    expect(client.status.state).toBe('unauthorized');
    expect(client.status.rejectionReason).toBe('expired');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(relay.receivedTokens).toEqual([tokenNumber(1)]);
    await harness.advanceAndSettle(60_000);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('goes unauthorized when the fresh token is refused too', async () => {
    const { relay } = setUp();
    relay.deniedReason = 'bad-signature';
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), tokenNumber(2), tokenNumber(3)),
    });
    await harness.settle();
    expect(client.status.state).toBe('unauthorized');
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
  });

  it('allows another retry after a refused token once a later one was accepted', async () => {
    const { relay } = setUp();
    relay.refusedTokens.set(tokenNumber(1), 'expired');
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), tokenNumber(2), tokenNumber(3)),
    });
    await harness.settle();
    relay.refusedTokens.set(tokenNumber(2), 'expired');
    relay.drop(4403, '');
    await harness.settle();
    expect(client.status.state).toBe('connected');
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2), tokenNumber(3)]);
  });

  it('backs off after one immediate retry when the relay accepts each token then closes 4401', async () => {
    const { relay } = setUp();
    relay.closeAfterAuth = { code: 4401, reason: 'Unauthorized' };
    const getToken = providerOf(tokenNumber(1), tokenNumber(2), tokenNumber(3), tokenNumber(4));
    const client = await harness.open({ getToken });
    await harness.settle();
    expect(relay.receivedTokens).toEqual([tokenNumber(1), tokenNumber(2)]);
    expect(client.status.state).toBe('reconnecting');
    const firstDelay = computeReconnectDelay(0, DEFAULT_RECONNECT_BACKOFF, 0);
    await harness.advanceAndSettle(firstDelay - 1);
    expect(relay.receivedTokens).toHaveLength(2);
    await harness.advanceAndSettle(1);
    expect(relay.receivedTokens).toHaveLength(3);
    await harness.advanceAndSettle(computeReconnectDelay(1, DEFAULT_RECONNECT_BACKOFF, 0) - 1);
    expect(relay.receivedTokens).toHaveLength(3);
    expect(client.status.state).toBe('reconnecting');
  });

  it('counts a provider failure as a failed attempt, reports it and retries with backoff', async () => {
    const { relay } = setUp();
    const errors: unknown[] = [];
    let isFailing = false;
    const getToken = vi.fn(() =>
      isFailing ? Promise.reject(new Error('backend down')) : Promise.resolve(tokenNumber(1)),
    );
    const client = await harness.open({
      getToken,
      onError: (error) => errors.push(error),
    });
    await harness.settle();
    isFailing = true;
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(client.status.state).toBe('reconnecting');
    expect(errors).toEqual([new Error('backend down')]);
    isFailing = false;
    await harness.advanceAndSettle(500);
    expect(client.status.state).toBe('connected');
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('goes unauthorized when a refreshed token opens another board', async () => {
    const { relay } = setUp();
    const errors: unknown[] = [];
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), unsignedToken({ ...EDITOR_CLAIMS, boardId: 'b-2' })),
      onError: (error) => errors.push(error),
    });
    await harness.settle();
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(client.status.state).toBe('unauthorized');
    expect(client.status.rejectionReason).toBe('wrong-board');
    expect(errors).toHaveLength(1);
  });

  it('goes unauthorized when a refreshed token is not a token at all', async () => {
    const { relay } = setUp();
    const errors: unknown[] = [];
    const client = await harness.open({
      getToken: providerOf(tokenNumber(1), 'not-a-token'),
      onError: (error) => errors.push(error),
    });
    await harness.settle();
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(client.status.state).toBe('unauthorized');
    expect(client.status.rejectionReason).toBe('malformed');
    expect(errors).toHaveLength(1);
  });

  it('ignores a token that arrives after the client was destroyed', async () => {
    const { relay } = setUp();
    let release: (token: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => {
      release = resolve;
    });
    const getToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(tokenNumber(1))
      .mockReturnValueOnce(late);
    const client = await harness.open({ getToken });
    await harness.settle();
    relay.drop();
    await harness.advanceAndSettle(250);
    expect(getToken).toHaveBeenCalledTimes(2);
    client.destroy();
    release(tokenNumber(2));
    await harness.settle();
    expect(relay.receivedTokens).toEqual([tokenNumber(1)]);
    expect(relay.openConnectionCount).toBe(0);
    expect(client.status.state).toBe('offline');
  });

  it('rejects creation when the first token cannot be fetched, or options name no token', async () => {
    setUp();
    await expect(
      harness.open({ getToken: () => Promise.reject(new Error('signed out')) }),
    ).rejects.toThrow('signed out');
    const store = new YjsDocumentStore();
    await expect(
      createCollabClient({ store, boardId: BOARD, url: 'ws://relay.test' }),
    ).rejects.toThrow(RangeError);
  });
});
