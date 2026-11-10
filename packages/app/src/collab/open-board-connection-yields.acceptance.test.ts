import { afterEach, describe, expect, it } from 'vitest';

import * as Collab from '@canvas/collab';

const yieldToBrowser = (Collab as typeof Collab & { yieldToBrowser: () => Promise<void> })
  .yieldToBrowser;

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import type { BoardConnection } from './board-connection.js';
import { openBoardConnection } from './open-board-connection.js';

const opened: BoardConnection[] = [];
afterEach(() => {
  for (const connection of opened.splice(0)) connection.destroy();
});

describe('openBoardConnection scheduling', () => {
  it('passes collab yieldToBrowser to the created client', async () => {
    let suppliedYield: (() => Promise<void>) | undefined;
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
        suppliedYield = (options as typeof options & { yieldToBrowser?: () => Promise<void> })
          .yieldToBrowser;
        const client = new FakeSyncClient(options);
        queueMicrotask(() => {
          client.moveTo('connected');
        });
        return Promise.resolve(client);
      },
      onError: () => undefined,
    });
    opened.push(connection);
    expect(suppliedYield).toBeTypeOf('function');
    expect(suppliedYield).toBe(yieldToBrowser);
  });
});
