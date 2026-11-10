// The inbound hold's edges that the acceptance tests do not reach.
import { expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore, type DocumentStore } from '@canvas/document';

import { InboundHold, MAX_HELD_INBOUND_BYTES, storeRunsOf, whenWritable } from './inbound-hold.js';
import { OutboundQueue } from './outbound-queue.js';
import { RelayConnection } from './relay-connection.js';
import { encodeUpdateMessage } from './relay-protocol.js';

/**
 * Lets `whenIdle` settle.
 *
 * @returns Resolves after a macrotask.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

it('holds nothing for a store that cannot run', () => {
  const store = { read: () => undefined } as unknown as DocumentStore;
  expect(storeRunsOf(store)).toBeUndefined();
  const apply = vi.fn();
  const hold = new InboundHold(store, { apply, onError: vi.fn() });
  expect(hold.shouldWait).toBe(false);
  const work = vi.fn();
  whenWritable(store, work);
  expect(work).toHaveBeenCalledTimes(1);
});

it('waits again when a new run began before it could release', async () => {
  const store = new YjsDocumentStore();
  const apply = vi.fn();
  const hold = new InboundHold(store, { apply, onError: vi.fn() });
  const first = store.beginRun();
  hold.holdUpdate(new Uint8Array([1]), false);
  first.close();
  const second = store.beginRun();
  await settle();
  expect(apply).not.toHaveBeenCalled();
  expect(hold.isHolding).toBe(true);
  second.close();
  await settle();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(hold.isHolding).toBe(false);
});

it('drops what it holds, and does no deferred work, when the store is destroyed', async () => {
  const store = new YjsDocumentStore();
  const apply = vi.fn();
  const hold = new InboundHold(store, { apply, onError: vi.fn() });
  store.beginRun();
  hold.holdUpdate(new Uint8Array([1]), false);
  const work = vi.fn();
  whenWritable(store, work);
  store.destroy();
  await settle();
  expect(apply).not.toHaveBeenCalled();
  expect(work).not.toHaveBeenCalled();
  expect(hold.isHolding).toBe(false);
});

it('reports a released update the store refuses when the host takes no receive errors', async () => {
  const store = new YjsDocumentStore();
  const reportError = vi.fn();
  const connection = new RelayConnection(
    {
      documentName: 'board',
      token: 'test',
      store,
      awareness: new Awareness(new Y.Doc()),
      queue: new OutboundQueue(),
      reportError,
      onStructRangeSplit: vi.fn(),
      applyRemoteUpdate: (update) => {
        store.applyUpdate(update, SYSTEM_ORIGIN);
      },
      onAuthenticated: vi.fn(),
      onSynced: vi.fn(),
      onProgress: vi.fn(),
      onRejected: vi.fn(),
      onClosedByRelay: vi.fn(),
    },
    vi.fn(),
  );
  const run = store.beginRun();
  connection.receive(encodeUpdateMessage('board', new Uint8Array([0xff, 0xff, 0xff])));
  expect(connection.hasHeldInbound).toBe(true);
  run.close();
  await settle();
  expect(reportError).toHaveBeenCalledTimes(1);
  expect(connection.hasHeldInbound).toBe(false);
});

it('counts each sync step 2 an overflow drops, held or arriving after it', () => {
  const store = new YjsDocumentStore();
  const onDroppedStepTwos = vi.fn();
  const hold = new InboundHold(store, { apply: vi.fn(), onError: vi.fn(), onDroppedStepTwos });
  const run = store.beginRun();
  hold.holdUpdate(new Uint8Array(4), true);
  hold.holdUpdate(new Uint8Array(MAX_HELD_INBOUND_BYTES), false);
  expect(onDroppedStepTwos).toHaveBeenCalledWith(1);
  hold.holdUpdate(new Uint8Array(4), true);
  hold.holdUpdate(new Uint8Array(4), false);
  expect(onDroppedStepTwos).toHaveBeenCalledTimes(2);
  const quiet = new InboundHold(store, { apply: vi.fn(), onError: vi.fn() });
  quiet.holdUpdate(new Uint8Array(MAX_HELD_INBOUND_BYTES + 1), false);
  quiet.holdUpdate(new Uint8Array(4), true);
  expect(quiet.isOverflowed).toBe(true);
  run.close();
});
