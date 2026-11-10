// CONTRACT: the collab client and the board connection share the same ephemeral reaction channel.
import { expect, it } from 'vitest';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import { openBoardConnection } from './open-board-connection.js';

it('gives the client the exact channel exposed by its synced board connection', async () => {
  let client: FakeSyncClient | undefined;
  const connection = await openBoardConnection({
    address: {
      boardId: 'board-1',
      relayUrl: 'ws://relay.test',
      token: undefined,
      tokenUrl: 'http://relay.test/token',
      assetsUrl: undefined,
    },
    guestSubject: () => 'guest-7',
    openCache: () => Promise.resolve(undefined),
    createClient: (options) => {
      client = new FakeSyncClient(options);
      const created = client;
      queueMicrotask(() => {
        created.moveTo('connected');
      });
      return Promise.resolve(created);
    },
    onError: () => undefined,
  });
  try {
    expect(connection.reactions).toBeDefined();
    expect(client?.options.reactions).toBe(connection.reactions);
  } finally {
    connection.destroy();
  }
});
