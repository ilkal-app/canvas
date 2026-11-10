import { afterEach, describe, expect, it, vi } from 'vitest';

import { colorForPrincipal, MemoryCacheStorage, MemoryDocumentCache } from '@canvas/collab';
import { SYSTEM_ORIGIN } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createDemoBoard } from '../engine/demo-board.js';
import { LOCAL_USER_ORIGIN, writeBoard } from '../engine/demo-document.js';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import type { BoardAddress } from './board-address.js';
import type { BoardConnection } from './board-connection.js';
import { TokenEndpointUnreachableError } from './board-token-provider.js';
import { openBoardConnection, type OpenBoardConnectionOptions } from './open-board-connection.js';

const ADDRESS: BoardAddress = {
  boardId: 'board-1',
  relayUrl: 'ws://relay.test',
  token: undefined,
  tokenUrl: 'http://relay.test/token',
  assetsUrl: undefined,
};
const DEMO_SIZE = createDemoBoard().length;

/** A board token the page was given (the client decodes, never verifies, it). */
const GIVEN_TOKEN = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: 'guest-9', boardId: 'board-1', role: 'editor', principal: 'user' },
]
  .map((part) => btoa(JSON.stringify(part)).replace(/=+$/, ''))
  .concat('signature')
  .join('.');

const opened: BoardConnection[] = [];

afterEach(() => {
  for (const connection of opened.splice(0)) connection.destroy();
});

/**
 * Opens a connection over a fake client, which the test moves to its first outcome.
 *
 * @param firstOutcome - What the client does once created, before the connection resolves.
 * @param overrides - Options to replace.
 * @returns The connection and the fake client.
 */
async function open(
  firstOutcome: (client: FakeSyncClient) => void,
  overrides: Partial<OpenBoardConnectionOptions> = {},
): Promise<{ connection: BoardConnection; client: FakeSyncClient | undefined }> {
  let client: FakeSyncClient | undefined;
  const connection = await openBoardConnection({
    address: ADDRESS,
    guestSubject: () => 'guest-7',
    openCache: () => Promise.resolve(undefined),
    createClient: (options) => {
      const created = new FakeSyncClient(options);
      client = created;
      queueMicrotask(() => {
        firstOutcome(created);
      });
      return Promise.resolve(created);
    },
    onError: () => undefined,
    ...overrides,
  });
  opened.push(connection);
  return { connection, client };
}

describe('openBoardConnection without a relay', () => {
  it('keeps working on a local demo board and says it is offline and local', async () => {
    const createClient = vi.fn();
    const connection = await openBoardConnection({
      address: { ...ADDRESS, relayUrl: undefined, tokenUrl: undefined },
      guestSubject: () => 'guest-7',
      createClient,
    });
    opened.push(connection);
    expect(createClient).not.toHaveBeenCalled();
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
    expect(connection.origin).toBe(LOCAL_USER_ORIGIN);
    expect(connection.status()).toEqual({
      boardId: 'board-1',
      state: 'offline',
      isLocalOnly: true,
      isSavedOnDevice: false,
      pendingUpdateCount: 0,
      isAcknowledged: false,
      isReadOnly: false,
      rejectionReason: undefined,
      collaborators: [],
      strandedEdits: [],
    });
  });
});

describe('openBoardConnection guest', () => {
  it('draws no guest for a local page, nor for a page that brings its token', async () => {
    const guestSubject = vi.fn(() => 'guest-7');
    const local = await openBoardConnection({
      address: { ...ADDRESS, relayUrl: undefined, tokenUrl: undefined },
      guestSubject,
    });
    opened.push(local);
    const { client } = await open(
      (fake) => {
        fake.moveTo('connected');
      },
      { address: { ...ADDRESS, token: GIVEN_TOKEN }, guestSubject },
    );
    await expect(client?.options.getToken?.()).resolves.toBe(GIVEN_TOKEN);
    expect(client?.options.presence).toEqual({ name: 'guest-9' });
    expect(guestSubject).not.toHaveBeenCalled();
  });
});

describe('openBoardConnection with a relay', () => {
  it('syncs the shell’s store: the client gets it, with the board, relay and a token provider', async () => {
    const { connection, client } = await open((fake) => {
      fake.moveTo('connected');
    });
    expect(client?.options.store).toBe(connection.store);
    expect(client?.options).toMatchObject({ boardId: 'board-1', url: 'ws://relay.test' });
    expect(client?.options.getToken).toBeTypeOf('function');
    expect(client?.options.presence).toEqual({ name: 'guest-7' });
    expect(connection.origin).toEqual({ kind: 'user', principalId: 'user:guest-7' });
    expect(connection.status()).toMatchObject({ state: 'connected', isLocalOnly: false });
  });

  it('seeds an empty board with the demo board once, after the first sync', async () => {
    const { connection } = await open((fake) => {
      fake.moveTo('connected');
    });
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
    const [first] = createDemoBoard();
    expect(connection.store.get(first?.id ?? ('' as ObjectId))).toMatchObject({
      createdBy: 'system',
    });
  });

  it('leaves a board that already has objects after the first sync as it is', async () => {
    let seeded = 0;
    const { connection } = await open((fake) => {
      writeBoard(fake.options.store, createDemoBoard().slice(0, 1));
      seeded = fake.options.store.read().objects.size;
      fake.moveTo('connected');
    });
    expect(seeded).toBe(1);
    expect(connection.store.read().objects.size).toBe(1);
  });

  it('does not seed a board someone cleared: emptied is not never written', async () => {
    const { connection } = await open((fake) => {
      // The relay's board once held an object that a user deleted: empty, but written.
      writeBoard(fake.options.store, createDemoBoard().slice(0, 1));
      const [first] = createDemoBoard();
      fake.options.store.transact(SYSTEM_ORIGIN, (transaction) => {
        transaction.deleteObject(first?.id ?? ('' as ObjectId));
      });
      fake.moveTo('connected');
    });
    expect(connection.store.read().objects.size).toBe(0);
  });

  it('falls back to a local demo board when the first attempt fails and nothing is cached', async () => {
    const { connection, client } = await open((fake) => {
      fake.moveTo('reconnecting');
    });
    expect(client?.isDestroyed).toBe(true);
    expect(connection.store).not.toBe(client?.options.store);
    expect(connection.store.read().objects.size).toBe(DEMO_SIZE);
    expect(connection.status()).toMatchObject({ state: 'offline', isLocalOnly: true });
  });

  it('says the board refused the token, rather than offline, when the first connection is refused', async () => {
    const { connection, client } = await open((fake) => {
      fake.moveTo('unauthorized');
    });
    expect(client?.isDestroyed).toBe(false);
    expect(connection.status()).toMatchObject({ state: 'unauthorized', isLocalOnly: false });
    expect(connection.store.read().objects.size).toBe(0);
  });

  it('falls back when the first attempt has not settled by the timeout', async () => {
    const { connection } = await open(() => undefined, { firstOutcomeTimeoutMs: 5 });
    expect(connection.status()).toMatchObject({ isLocalOnly: true });
  });

  it('falls back when the client cannot be created, reporting why', async () => {
    const errors: unknown[] = [];
    const connection = await openBoardConnection({
      address: ADDRESS,
      guestSubject: () => 'guest-7',
      openCache: () => Promise.resolve(undefined),
      createClient: () => Promise.reject(new Error('token endpoint down')),
      onError: (error) => errors.push(error),
    });
    opened.push(connection);
    expect(errors).toEqual([new Error('token endpoint down')]);
    expect(connection.status()).toMatchObject({ isLocalOnly: true });
  });

  it('keeps the cached board and keeps retrying when the relay is down', async () => {
    const { connection, client } = await open((fake) => {
      writeBoard(fake.options.store, createDemoBoard().slice(0, 3));
      fake.moveTo('reconnecting');
    });
    expect(client?.isDestroyed).toBe(false);
    expect(connection.store).toBe(client?.options.store);
    expect(connection.store.read().objects.size).toBe(3);
    expect(connection.status()).toMatchObject({ state: 'reconnecting', isLocalOnly: false });
  });

  it('reports each state change and the collaborators presence shows', async () => {
    const { connection, client } = await open((fake) => {
      fake.moveTo('connected');
    });
    const listener = vi.fn();
    connection.subscribe(listener);
    client?.showRemote([
      {
        principal: { id: 'guest-9', kind: 'user', name: 'guest-9', color: '#112233' },
        updatedAt: 0,
      },
    ]);
    expect(connection.status().collaborators).toEqual([
      // Their colourway's dark, from their id: the colour the peer sent is not shown.
      {
        principalId: 'guest-9',
        kind: 'user',
        name: 'guest-9',
        color: colorForPrincipal('guest-9'),
      },
    ]);
    client?.moveTo('reconnecting');
    expect(connection.status().state).toBe('reconnecting');
    expect(listener).toHaveBeenCalledTimes(2);
    connection.destroy();
    expect(client?.isDestroyed).toBe(true);
  });

  it('connects without a cache that cannot be opened, reporting why', async () => {
    const errors: unknown[] = [];
    const { client } = await open(
      (fake) => {
        fake.moveTo('connected');
      },
      {
        openCache: () => Promise.reject(new Error('quota')),
        onError: (error) => errors.push(error),
      },
    );
    expect(errors).toEqual([new Error('quota')]);
    expect(client?.options.cache).toBeUndefined();
  });

  it('holds the cache compactions on the fallback of a configured relay', async () => {
    const storage = new MemoryCacheStorage();
    const { connection } = await open(
      (fake) => {
        fake.moveTo('reconnecting');
      },
      { openCache: () => Promise.resolve(new MemoryDocumentCache(storage)) },
    );
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isSavedOnDevice: true });
    const [first] = connection.store.read().objects.values();
    if (first === undefined) throw new Error('the fallback is seeded');
    for (let index = 0; index < 600; index += 1) {
      connection.store.transact(connection.origin, (transaction) => {
        transaction.setObject({ ...first, x: index });
      });
    }
    for (let round = 0; round < 5; round += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    expect(storage.board(ADDRESS.boardId).snapshot).toBeUndefined();
  });

  it('hands the cache to the local board when it falls back; each connection closes it', async () => {
    const cache = new MemoryDocumentCache();
    const close = vi.spyOn(cache, 'close');
    const local = await open(
      (fake) => {
        fake.moveTo('reconnecting');
      },
      { openCache: () => Promise.resolve(cache) },
    );
    expect(local.connection.status()).toMatchObject({ isLocalOnly: true, isSavedOnDevice: true });
    expect(close).not.toHaveBeenCalled();
    local.connection.destroy();
    expect(close).toHaveBeenCalledOnce();
    const synced = await open(
      (fake) => {
        fake.moveTo('connected');
      },
      { openCache: () => Promise.resolve(cache) },
    );
    expect(synced.connection.status().isSavedOnDevice).toBe(true);
    synced.connection.destroy();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('does not report a token endpoint that does not answer (it means no relay), only the rest', async () => {
    const errors: unknown[] = [];
    const onError = (error: unknown): void => {
      errors.push(error);
    };
    const unreachable = new TokenEndpointUnreachableError('http://relay.test/token', 'refused');
    const { client } = await open(
      (fake) => {
        fake.moveTo('connected');
      },
      { onError },
    );
    client?.options.onError?.(unreachable);
    client?.options.onError?.(new Error('bad frame'));
    const local = await open(() => undefined, {
      createClient: () => Promise.reject(unreachable),
      onError,
    });
    expect(errors).toEqual([new Error('bad frame')]);
    expect(local.connection.status().isLocalOnly).toBe(true);
  });

  it('opens no cache where there is no IndexedDB, and reports to the page by default', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    try {
      const connection = await openBoardConnection({
        address: ADDRESS,
        guestSubject: () => 'guest-7',
        createClient: () => Promise.reject(new Error('no token')),
      });
      opened.push(connection);
      expect(reportError).toHaveBeenCalledWith(new Error('no token'));
      expect(connection.status().isLocalOnly).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports no collaborators for a client without presence', async () => {
    const { connection } = await open(
      (fake) => {
        fake.moveTo('connected');
      },
      {
        createClient: (options) => {
          const fake = new FakeSyncClient(options, false);
          queueMicrotask(() => {
            fake.moveTo('connected');
          });
          return Promise.resolve(fake);
        },
      },
    );
    expect(connection.status().collaborators).toEqual([]);
  });

  it('opens the IndexedDB cache where there is IndexedDB, and goes on without one that fails', async () => {
    const errors: unknown[] = [];
    let cache: unknown = 'not asked';
    vi.stubGlobal('indexedDB', {});
    try {
      const connection = await openBoardConnection({
        address: ADDRESS,
        guestSubject: () => 'guest-7',
        createClient: (options) => {
          cache = options.cache;
          const fake = new FakeSyncClient(options);
          queueMicrotask(() => {
            fake.moveTo('connected');
          });
          return Promise.resolve(fake);
        },
        onError: (error) => errors.push(error),
      });
      opened.push(connection);
      expect(errors).toHaveLength(1);
      expect(cache).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const { connection, client } = await open((fake) => {
      fake.moveTo('connected');
    });
    const listener = vi.fn();
    const stop = connection.subscribe(listener);
    stop();
    client?.moveTo('reconnecting');
    expect(listener).not.toHaveBeenCalled();
  });
});
