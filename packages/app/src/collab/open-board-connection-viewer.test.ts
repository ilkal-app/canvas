// A viewer's board when the relay does not answer at open (review I-1): never an
// editable local board.
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryCacheStorage, MemoryDocumentCache, type BoardTokenRole } from '@canvas/collab';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import type { BoardAddress } from './board-address.js';
import type { BoardConnection } from './board-connection.js';
import { openBoardConnection, type OpenBoardConnectionOptions } from './open-board-connection.js';

const ADDRESS: BoardAddress = {
  boardId: 'board-1',
  relayUrl: 'ws://relay.test',
  token: undefined,
  tokenUrl: 'http://relay.test/token',
  assetsUrl: undefined,
};

const opened: BoardConnection[] = [];

afterEach(() => {
  for (const connection of opened.splice(0)) connection.destroy();
});

/**
 * Opens a connection on an empty device over a fake client with the role's token, whose relay
 * never answers within the first-outcome timeout.
 *
 * @param role - The token's role.
 * @param overrides - Options to replace.
 * @returns The connection and the fake client.
 */
async function openUnanswered(
  role: BoardTokenRole,
  overrides: Partial<OpenBoardConnectionOptions> = {},
): Promise<{ connection: BoardConnection; client: FakeSyncClient | undefined }> {
  let client: FakeSyncClient | undefined;
  const connection = await openBoardConnection({
    address: ADDRESS,
    guestSubject: () => 'guest-7',
    openCache: () => Promise.resolve(undefined),
    createClient: (options) => {
      client = new FakeSyncClient(options, true, role);
      return Promise.resolve(client);
    },
    firstOutcomeTimeoutMs: 5,
    shouldSeedDemoBoard: false,
    onError: () => undefined,
    ...overrides,
  });
  opened.push(connection);
  return { connection, client };
}

describe('openBoardConnection for a viewer whose relay does not answer at open', () => {
  it('stays synced and read-only, not an editable local board, and keeps trying', async () => {
    const { connection, client } = await openUnanswered('viewer');
    expect(client?.isDestroyed).toBe(false);
    expect(connection.store).toBe(client?.options.store);
    expect(connection.status()).toMatchObject({ isLocalOnly: false, isReadOnly: true });
  });

  it('fills in and follows the relay once it answers, a viewer or, if upgraded meanwhile, an editor', async () => {
    const viewer = await openUnanswered('viewer');
    viewer.client?.answer(true);
    viewer.client?.moveTo('connected');
    expect(viewer.connection.status()).toMatchObject({ state: 'connected', isReadOnly: true });
    const upgraded = await openUnanswered('viewer');
    upgraded.client?.answer(false);
    upgraded.client?.moveTo('connected');
    expect(upgraded.connection.status()).toMatchObject({ state: 'connected', isReadOnly: false });
  });

  it('hands the client the board’s reactions channel, which the connection exposes', async () => {
    // A viewer's page stays synced (a viewer still sees everyone else's reactions).
    const { connection, client } = await openUnanswered('viewer');
    expect(connection.reactions).toBeDefined();
    expect(client?.options.reactions).toBe(connection.reactions);
  });

  it('treats a commenter as a viewer', async () => {
    const { connection } = await openUnanswered('commenter');
    expect(connection.status()).toMatchObject({ isLocalOnly: false, isReadOnly: true });
  });

  it('still falls back to an editable local board for an editor', async () => {
    const { connection, client } = await openUnanswered('editor');
    expect(client?.isDestroyed).toBe(true);
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isReadOnly: false });
  });

  it('keeps the page’s word on a local board opened with no token: the client could not start', async () => {
    const connection = await openBoardConnection({
      address: ADDRESS,
      guestSubject: () => 'guest-7',
      openCache: () => Promise.resolve(undefined),
      createClient: () => Promise.reject(new Error('token endpoint down')),
      shouldSeedDemoBoard: false,
      isReadOnly: true,
      onError: () => undefined,
    });
    opened.push(connection);
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isReadOnly: true });
  });

  it('keeps the page’s word on a local board with no relay configured', async () => {
    const connection = await openBoardConnection({
      address: { ...ADDRESS, relayUrl: undefined, tokenUrl: undefined },
      guestSubject: () => 'guest-7',
      openCache: () => Promise.resolve(undefined),
      shouldSeedDemoBoard: false,
      isReadOnly: true,
    });
    opened.push(connection);
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isReadOnly: true });
  });

  it('holds no compaction on a viewer’s local board, which has nothing to send', async () => {
    const storage = new MemoryCacheStorage();
    const connection = await openBoardConnection({
      address: ADDRESS,
      guestSubject: () => 'guest-7',
      openCache: () => Promise.resolve(new MemoryDocumentCache(storage)),
      createClient: () => Promise.reject(new Error('token endpoint down')),
      isReadOnly: true,
      onError: () => undefined,
    });
    opened.push(connection);
    expect(connection.status()).toMatchObject({ isLocalOnly: true, isReadOnly: true });
    const [first] = connection.store.read().objects.values();
    if (first === undefined) throw new Error('the fallback is seeded');
    // Writes the shell never makes for a viewer, standing in for a board's growing history.
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
    expect(storage.board(ADDRESS.boardId).snapshot).toBeDefined();
  });
});
