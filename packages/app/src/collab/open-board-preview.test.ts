import { describe, expect, it, vi } from 'vitest';

import { MemoryDocumentCache } from '@canvas/collab';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import { openBoardConnection, type OpenBoardConnectionOptions } from './open-board-connection.js';

const ADDRESS = {
  boardId: 'board-1',
  relayUrl: 'ws://relay.test',
  token: undefined,
  tokenUrl: 'http://relay.test/token',
  assetsUrl: undefined,
};

describe('authorized preview hydration barrier', () => {
  it('retains one cache and image adapter while delaying client hydration', async () => {
    const cache = new MemoryDocumentCache();
    const openCache = vi.fn(() => Promise.resolve(cache));
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const beforeHydration = vi.fn<NonNullable<OpenBoardConnectionOptions['beforeHydration']>>(
      () => gate,
    );
    const createClient = vi.fn<NonNullable<OpenBoardConnectionOptions['createClient']>>(
      (options) => {
        const client = new FakeSyncClient(options);
        queueMicrotask(() => {
          client.moveTo('connected');
        });
        return Promise.resolve(client);
      },
    );
    const opening = openBoardConnection({
      address: ADDRESS,
      guestSubject: () => 'guest',
      openCache,
      createClient,
      beforeHydration,
      shouldSeedDemoBoard: false,
    });
    await vi.waitFor(() => {
      expect(beforeHydration).toHaveBeenCalledOnce();
    });
    expect(beforeHydration.mock.calls[0]?.[0]).toBe(cache);
    expect(createClient).not.toHaveBeenCalled();
    release();
    const connection = await opening;
    connection.destroy();
    expect(openCache).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
    expect(connection.images).toBe(beforeHydration.mock.calls[0]?.[1]);
  });
});
