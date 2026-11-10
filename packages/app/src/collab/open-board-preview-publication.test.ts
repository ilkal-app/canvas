import { afterEach, expect, it, vi } from 'vitest';

import type { CollabClientOptions } from '@canvas/collab';

import { FakeSyncClient } from './__fixtures__/fake-sync-client.js';
import type { BoardConnection, BoardSyncClient } from './board-connection.js';
import { openBoardConnection } from './open-board-connection.js';

const opened: BoardConnection[] = [];
afterEach(() => {
  for (const connection of opened.splice(0)) connection.destroy();
});

async function setup(carryOver?: BoardSyncClient['layoutCarryOver']) {
  const prepare = vi.fn(() => Promise.resolve(new Uint8Array([42])));
  let client: FakeSyncClient | undefined;
  let seen: CollabClientOptions | undefined;
  const connection = await openBoardConnection({
    address: {
      boardId: 'board-1',
      relayUrl: 'ws://relay.test',
      token: undefined,
      tokenUrl: 'http://relay.test/token',
      assetsUrl: undefined,
    },
    guestSubject: () => 'guest',
    openCache: () => Promise.resolve(undefined),
    prepareSnapshotPreview: prepare,
    onError: () => undefined,
    createClient: (options) => {
      seen = options;
      client = new FakeSyncClient(options);
      client.layoutCarryOver = carryOver;
      const created = client;
      queueMicrotask(() => {
        created.moveTo('connected');
      });
      return Promise.resolve(created);
    },
  });
  opened.push(connection);
  if (client === undefined || seen === undefined) throw new Error('Missing client.');
  return { client, seen, prepare };
}

it('awaits existing carry-over only after connected and refuses stranded copies', async () => {
  let finish = (): void => undefined;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const carryOver = {
    stranded: [],
    run,
    subscribe: () => () => undefined,
    dismiss: () => Promise.resolve(),
  };
  const { client, seen, prepare } = await setup(carryOver);
  client.moveTo('reconnecting');
  expect(await seen.prepareSnapshotPreview?.()).toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  client.moveTo('connected');
  const preparing = seen.prepareSnapshotPreview?.();
  expect(run).toHaveBeenCalledWith(true);
  expect(prepare).not.toHaveBeenCalled();
  finish();
  expect(await preparing).toEqual(new Uint8Array([42]));
});

it('refuses reported carry-over failures and unknown carry-over implementations', async () => {
  const { seen, prepare } = await setup({
    stranded: [],
    subscribe: () => () => undefined,
    dismiss: () => Promise.resolve(),
  });
  expect(await seen.prepareSnapshotPreview?.()).toBeUndefined();
  expect(prepare).not.toHaveBeenCalled();
  const normal = await setup();
  normal.seen.onError?.(new Error('carry-over failed'));
  expect(await normal.seen.prepareSnapshotPreview?.()).toBeUndefined();
  expect(normal.prepare).not.toHaveBeenCalled();
});

it('rechecks connection errors after asynchronous renderer capture', async () => {
  const { seen, prepare } = await setup();
  let finish: (bytes: Uint8Array<ArrayBuffer>) => void = () => undefined;
  prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const preparing = seen.prepareSnapshotPreview?.();
  seen.onError?.(new Error('late failure'));
  finish(new Uint8Array([42]));
  expect(await preparing).toBeUndefined();
});

it('does not publish after carry-over strands edits or the relay disconnects while carrying', async () => {
  const stranded = [
    {
      boardId: 'board-1',
      source: 'old',
      fromLayoutVersion: 1,
      toLayoutVersion: 2,
      unsentChangeCount: 1,
    },
  ];
  const blocked = await setup({
    stranded,
    run: () => Promise.resolve(),
    subscribe: () => () => undefined,
    dismiss: () => Promise.resolve(),
  });
  expect(await blocked.seen.prepareSnapshotPreview?.()).toBeUndefined();
  expect(blocked.prepare).not.toHaveBeenCalled();
  let finish = (): void => undefined;
  const disconnect = await setup({
    stranded: [],
    run: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    subscribe: () => () => undefined,
    dismiss: () => Promise.resolve(),
  });
  const pending = disconnect.seen.prepareSnapshotPreview?.();
  disconnect.client.moveTo('reconnecting');
  finish();
  expect(await pending).toBeUndefined();
  expect(disconnect.prepare).not.toHaveBeenCalled();
});
