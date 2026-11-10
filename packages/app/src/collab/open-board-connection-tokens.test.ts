import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryDocumentCache } from '@canvas/collab';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import type { BoardAddress } from './board-address.js';
import type { BoardConnection } from './board-connection.js';
import { providedImageAccess } from './board-images.js';
import { openBoardConnection } from './open-board-connection.js';
import type { ProvidedBoardTokens } from './provided-board-tokens.js';

const ADDRESS: BoardAddress = {
  boardId: 'board-1',
  relayUrl: 'ws://relay.test',
  token: undefined,
  tokenUrl: undefined,
  assetsUrl: 'http://assets.test',
};

const opened: BoardConnection[] = [];

afterEach(() => {
  for (const connection of opened.splice(0)) connection.destroy();
});

/**
 * Tokens from a source of the page's own (the site's API), each a spy.
 *
 * @returns The tokens.
 */
function providedTokens() {
  return {
    getToken: vi.fn(() => Promise.resolve('token-a')),
    freshToken: vi.fn(() => Promise.resolve('token-b')),
    tokenFor: vi.fn((boardId: string) => Promise.resolve(`token-${boardId}`)),
    presenceName: 'Ada Lovelace',
  } satisfies ProvidedBoardTokens;
}

describe('openBoardConnection with tokens the page provides', () => {
  it('connects with them, under the person’s name, and never asks for a guest', async () => {
    const tokens = providedTokens();
    const guestSubject = vi.fn(() => 'guest-7');
    let client: FakeSyncClient | undefined;
    const connection = await openBoardConnection({
      address: ADDRESS,
      guestSubject,
      tokens,
      shouldSeedDemoBoard: false,
      openCache: () => Promise.resolve(undefined),
      createClient: (options) => {
        client = new FakeSyncClient(options);
        const created = client;
        queueMicrotask(() => {
          created.moveTo('connected');
        });
        return Promise.resolve(created);
      },
    });
    opened.push(connection);
    expect(client?.options.getToken).toBe(tokens.getToken);
    expect(client?.options.presence).toEqual({ name: 'Ada Lovelace' });
    expect(guestSubject).not.toHaveBeenCalled();
    // A board nobody has written stays empty: the demo board is the playground's.
    expect(connection.store.read().objects.size).toBe(0);
    expect(connection.images).toBeDefined();
  });

  it('keeps an unreachable board empty on this device too', async () => {
    const connection = await openBoardConnection({
      address: ADDRESS,
      guestSubject: () => 'guest-7',
      tokens: providedTokens(),
      shouldSeedDemoBoard: false,
      openCache: () => Promise.resolve(new MemoryDocumentCache()),
      createClient: (options) => {
        const created = new FakeSyncClient(options);
        queueMicrotask(() => {
          created.moveTo('reconnecting');
        });
        return Promise.resolve(created);
      },
      firstOutcomeTimeoutMs: 1_000,
      onError: () => undefined,
    });
    opened.push(connection);
    expect(connection.status()).toMatchObject({ isLocalOnly: true });
    expect(connection.store.read().objects.size).toBe(0);
  });
});

describe('providedImageAccess', () => {
  it('reads the board’s images with the provided tokens, a fresh one after a refusal', async () => {
    const tokens = providedTokens();
    const access = providedImageAccess(ADDRESS, tokens);
    expect(access).toMatchObject({ assetsUrl: 'http://assets.test', boardId: 'board-1' });
    await expect(access?.token(false)).resolves.toBe('token-a');
    await expect(access?.token(true)).resolves.toBe('token-b');
    await expect(access?.tokenFor('board-2')).resolves.toBe('token-board-2');
  });

  it('gives none without an assets service', () => {
    expect(providedImageAccess({ ...ADDRESS, assetsUrl: undefined }, providedTokens())).toBe(
      undefined,
    );
  });
});
