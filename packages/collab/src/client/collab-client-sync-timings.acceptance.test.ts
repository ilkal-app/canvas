import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { ClientHarness } from './__fixtures__/client-harness.js';
import { decodeRelayMessage } from './relay-protocol.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
  vi.restoreAllMocks();
});

/**
 * Reads the proposed public method while the implementation has yet to add its type.
 *
 * @param client - The collab client under test.
 * @returns The method's untyped result.
 */
function timings(client: object): unknown {
  const method: unknown = Reflect.get(client, 'syncTimings');
  if (typeof method !== 'function') return undefined;
  return Reflect.apply(method, client, []);
}

it('measures auth, relay receipt, and local application from consecutive monotonic marks', async () => {
  harness = new ClientHarness();
  let nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  const store = new YjsDocumentStore();
  const originalApply = store.applyUpdate.bind(store);
  vi.spyOn(store, 'applyUpdate').mockImplementation((update, origin) => {
    nowMs += 11;
    originalApply(update, origin);
  });
  const client = await harness.open({
    store,
    socketFactory: (url, handlers) =>
      harness.relay.socketFactory(url, {
        ...handlers,
        onOpen: () => {
          nowMs += 3;
          handlers.onOpen();
        },
        onMessage: (data) => {
          const kind = decodeRelayMessage(data, client.boardId).kind;
          if (kind === 'authenticated') nowMs += 5;
          if (kind === 'sync-step-2') nowMs += 7;
          handlers.onMessage(data);
        },
      }),
  });
  expect(timings(client)).toBeUndefined();
  harness.relay.run();
  expect(client.status.state).toBe('connected');
  expect(client).toHaveProperty('syncTimings', expect.any(Function));
  expect(timings(client)).toEqual({ authMs: 8, receiveMs: 7, applyMs: 11 });
});

it('includes the cost of applying a seeded relay update in applyMs', async () => {
  let nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  const measure = async (count: number): Promise<number> => {
    harness = new ClientHarness();
    const seeded = new YjsDocumentStore();
    addStickies(seeded, count, { seed: 489 });
    Y.applyUpdate(harness.relay.doc, seeded.encodeState());
    const store = new YjsDocumentStore();
    const originalApply = store.applyUpdate.bind(store);
    vi.spyOn(store, 'applyUpdate').mockImplementation((update, origin) => {
      nowMs += update.byteLength / 100;
      originalApply(update, origin);
    });
    const client = await harness.open({ store });
    harness.relay.run();
    expect(store.read().objects.size).toBe(count);
    expect(client.status.state).toBe('connected');
    expect(client).toHaveProperty('syncTimings', expect.any(Function));
    const measured = timings(client);
    if (measured === null || typeof measured !== 'object') throw new Error('No sync timings');
    for (const phase of ['authMs', 'receiveMs', 'applyMs']) {
      const value: unknown = Reflect.get(measured, phase);
      expect(typeof value, phase).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
    const applyMs: unknown = Reflect.get(measured, 'applyMs');
    if (typeof applyMs !== 'number') throw new Error('No apply timing');
    harness.destroy();
    nowMs = 0;
    return applyMs;
  };
  const smallApplyMs = await measure(1);
  const largeApplyMs = await measure(200);
  expect(largeApplyMs).toBeGreaterThan(smallApplyMs);
});
