import * as encoding from 'lib0/encoding';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createObjectsCommand, startRun, StoreBusyError, YjsDocumentStore } from '@canvas/document';
import { createSeededIdGenerator, type PrincipalId } from '@canvas/schema';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { InboundHold, MAX_HELD_INBOUND_BYTES } from './inbound-hold.js';
import { decodeRelayMessage, encodeUpdateMessage, RELAY_MESSAGE_TYPES } from './relay-protocol.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
let harness: ClientHarness | undefined;

afterEach(() => {
  if (harness !== undefined) harness.destroy();
});

function pasteObjects(count: number) {
  return Array.from({ length: count }, (value, index) => ({
    type: 'shape' as const,
    id: `paste-${String(index)}`,
    parentId: null,
    x: index * 2,
    y: 0,
    width: 1,
    height: 1,
    kind: 'rectangle' as const,
    stroke: null,
    fill: [1, 0, 0, 1] as [number, number, number, number],
    cornerRadius: 0,
    sides: 4,
    label: null,
  }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function beginPaste(store: YjsDocumentStore, gate: ReturnType<typeof deferred>) {
  const pending = startRun(
    store,
    ADA,
    createObjectsCommand,
    { objects: pasteObjects(12) },
    { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(557) },
    { maxWrites: 4, yieldToBrowser: () => gate.promise },
  );
  if (!(pending instanceof Promise)) throw new Error('expected a stepped paste');
  return pending;
}

function authFrame(isReadOnly: boolean): Uint8Array {
  const frame = encoding.createEncoder();
  encoding.writeVarString(frame, BOARD);
  encoding.writeVarUint(frame, RELAY_MESSAGE_TYPES.auth);
  encoding.writeVarUint(frame, 2);
  encoding.writeVarString(frame, isReadOnly ? 'readonly' : 'read-write');
  return encoding.toUint8Array(frame);
}

it('pauses release when the first held update starts another stepped run', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const errors: unknown[] = [];
  const client = await harness.connect({ store, onError: (error) => errors.push(error) });
  const peer = new YjsDocumentStore();
  const updates: Uint8Array[] = [];
  peer.subscribeUpdates(({ update }) => updates.push(update));
  const ids = addStickies(peer, 3, { seed: 560, batchSize: 1 });
  const applied: string[] = [];
  const gate = deferred();
  let pending: Promise<unknown> | undefined;
  let shouldStart = false;
  store.subscribe((changes) => {
    if (changes.isLocal) return;
    applied.push(...changes.created);
    if (applied.length === 1) shouldStart = true;
  });
  const applyUpdate = store.applyUpdate.bind(store);
  vi.spyOn(store, 'applyUpdate').mockImplementation((update, origin) => {
    applyUpdate(update, origin);
    // The store forbids writes inside a listener; start as soon as its transaction returns.
    if (shouldStart) {
      shouldStart = false;
      pending = beginPaste(store, gate);
    }
  });
  const firstRun = store.beginRun();
  for (const update of updates) Y.applyUpdate(harness.relay.doc, update);
  harness.relay.run();
  expect(applied).toEqual([]);
  firstRun.close();
  await vi.waitFor(() => {
    expect(pending).toBeDefined();
  });
  const wasRunning = store.isRunning;
  const appliedWhileRunning = [...applied];
  const errorsWhileRunning = [...errors];
  const stateWhileRunning = client.status.state;
  gate.resolve();
  await pending;
  await harness.settle();
  expect(wasRunning).toBe(true);
  expect(appliedWhileRunning).toEqual(ids.slice(0, 1));
  expect(errorsWhileRunning).toEqual([]);
  expect(stateWhileRunning).toBe('connected');
  expect(applied).toEqual(ids);
  expect(errors.some((error) => error instanceof StoreBusyError)).toBe(false);
  expect(errors).toEqual([]);
  expect(client.status.state).toBe('connected');
  expect(store.encodeStateVector()).toEqual(Y.encodeStateVector(harness.relay.doc));
});

it('discards overflow and later frames, then recovers every peer update through a fresh sync', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const errors: unknown[] = [];
  const relay = harness.relay;
  const sent: Uint8Array[] = [];
  const client = await harness.connect({
    store,
    onError: (error) => errors.push(error),
    socketFactory: (url, handlers) => {
      const socket = relay.socketFactory(url, handlers);
      return {
        send: (data) => {
          sent.push(data);
          socket.send(data);
        },
        close: () => {
          socket.close();
        },
      };
    },
  });
  const sentSteps = () =>
    sent.filter((frame) => decodeRelayMessage(frame, BOARD).kind === 'sync-step-1').length;
  const initialSteps = sentSteps();
  const beforeSync = client.lastSyncedAt;
  if (beforeSync === undefined) throw new Error('expected the initial sync to complete');
  harness.time.advanceBy(100);
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('meta').set('overflow', 'x'.repeat(MAX_HELD_INBOUND_BYTES + 1));
  Y.applyUpdate(harness.relay.doc, Y.encodeStateAsUpdate(peer));
  harness.relay.run();
  peer.getMap('meta').set('after-overflow', 'still needed');
  Y.applyUpdate(harness.relay.doc, Y.encodeStateAsUpdate(peer));
  harness.relay.run();
  expect(store.isRunning).toBe(true);
  expect(client.lastSyncedAt).toBe(beforeSync);
  gate.resolve();
  await expect(pending).rejects.toMatchObject({
    name: 'RunStoppedError',
    cause: { name: 'RunStopRequest', reason: 'inbound-backlog' },
  });
  await vi.waitFor(() => {
    expect(sentSteps()).toBe(initialSteps + 1);
  });
  expect(client.lastSyncedAt).toBe(beforeSync);
  expect(store.encodeStateVector()).not.toEqual(Y.encodeStateVector(harness.relay.doc));
  await harness.settle();
  expect(store.encodeStateVector()).toEqual(Y.encodeStateVector(harness.relay.doc));
  expect(client.status.state).toBe('connected');
  expect(client.lastSyncedAt).toBeGreaterThan(beforeSync);
  expect(errors).toEqual([]);
});

it('waits for the overflow resync answer before acknowledging delayed local updates', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const relay = harness.relay;
  const delayedStatuses: (() => void)[] = [];
  const delayedStepTwos: (() => void)[] = [];
  let shouldDelayResponses = false;
  const client = await harness.connect({
    store,
    socketFactory: (url, handlers) =>
      relay.socketFactory(url, {
        ...handlers,
        onMessage: (data) => {
          const kind = decodeRelayMessage(data, BOARD).kind;
          if (shouldDelayResponses && kind === 'sync-status') {
            delayedStatuses.push(() => {
              handlers.onMessage(data);
            });
          } else if (shouldDelayResponses && kind === 'sync-step-2') {
            delayedStepTwos.push(() => {
              handlers.onMessage(data);
            });
          } else {
            handlers.onMessage(data);
          }
        },
      }),
  });
  const beforeSync = client.lastSyncedAt;
  if (beforeSync === undefined) throw new Error('expected the initial sync to complete');
  shouldDelayResponses = true;
  addStickies(store, 1, { seed: 561 });
  relay.run();
  expect(delayedStatuses).toHaveLength(1);
  expect(client.status.isAcknowledged).toBe(false);

  harness.time.advanceBy(100);
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('meta').set('overflow', 'x'.repeat(MAX_HELD_INBOUND_BYTES + 1));
  Y.applyUpdate(relay.doc, Y.encodeStateAsUpdate(peer));
  relay.run();
  peer.getMap('meta').set('after-overflow', 'still needed');
  Y.applyUpdate(relay.doc, Y.encodeStateAsUpdate(peer));
  relay.run();
  expect(store.isRunning).toBe(true);
  gate.resolve();
  await expect(pending).rejects.toMatchObject({
    name: 'RunStoppedError',
    cause: { name: 'RunStopRequest', reason: 'inbound-backlog' },
  });
  await vi.waitFor(() => {
    relay.run();
    expect(relay.received.filter((frame) => frame.kind === 'sync-step-1')).toHaveLength(2);
  });
  expect(delayedStepTwos).toHaveLength(1);
  expect(store.encodeStateVector()).not.toEqual(Y.encodeStateVector(relay.doc));

  for (const deliver of delayedStatuses.splice(0)) deliver();
  expect(client.lastSyncedAt).toBe(beforeSync);
  expect(client.status.isAcknowledged).toBe(false);

  shouldDelayResponses = false;
  for (const deliver of delayedStepTwos.splice(0)) deliver();
  await harness.settle();
  expect(client.lastSyncedAt).toBeGreaterThan(beforeSync);
  expect(client.status.isAcknowledged).toBe(true);
  expect(store.encodeStateVector()).toEqual(Y.encodeStateVector(relay.doc));
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, store.encodeSyncState(Y.encodeStateVector(recovered)));
  expect(recovered.getMap('meta').get('overflow')).toBe('x'.repeat(MAX_HELD_INBOUND_BYTES + 1));
  expect(recovered.getMap('meta').get('after-overflow')).toBe('still needed');
});

it('settles a resync answer dropped by a second overflow before acknowledging the next answer', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const relay = harness.relay;
  const sent: Uint8Array[] = [];
  const delayedStatuses: (() => void)[] = [];
  let shouldDelayStatuses = false;
  let receivedStepTwos = 0;
  const client = await harness.connect({
    store,
    socketFactory: (url, handlers) => {
      const socket = relay.socketFactory(url, {
        ...handlers,
        onMessage: (data) => {
          const kind = decodeRelayMessage(data, BOARD).kind;
          if (kind === 'sync-step-2') receivedStepTwos += 1;
          if (shouldDelayStatuses && kind === 'sync-status') {
            delayedStatuses.push(() => {
              handlers.onMessage(data);
            });
          } else {
            handlers.onMessage(data);
          }
        },
      });
      return {
        send: (data) => {
          sent.push(data);
          socket.send(data);
        },
        close: () => {
          socket.close();
        },
      };
    },
  });
  const sentSteps = () =>
    sent.filter((frame) => decodeRelayMessage(frame, BOARD).kind === 'sync-step-1').length;
  const initialSteps = sentSteps();
  const initialStepTwos = receivedStepTwos;
  const beforeSync = client.lastSyncedAt;
  if (beforeSync === undefined) throw new Error('expected the initial sync to complete');
  shouldDelayStatuses = true;
  addStickies(store, 1, { seed: 562 });
  relay.run();
  expect(delayedStatuses).toHaveLength(1);
  expect(client.status.isAcknowledged).toBe(false);
  harness.time.advanceBy(100);

  const peer = new Y.Doc();
  peer.getMap('meta').set('large-peer-update', 'x'.repeat(MAX_HELD_INBOUND_BYTES / 2 + 1024));
  const largeUpdate = Y.encodeStateAsUpdate(peer);
  expect(largeUpdate.byteLength).toBeLessThan(MAX_HELD_INBOUND_BYTES);
  const firstRun = store.beginRun();
  Y.applyUpdate(relay.doc, largeUpdate);
  relay.sendToAll((name) => encodeUpdateMessage(name, largeUpdate));
  relay.run();
  peer.getMap('meta').set('after-first-overflow', 'first dropped update');
  Y.applyUpdate(relay.doc, Y.encodeStateAsUpdate(peer));
  relay.run();
  expect(client.lastSyncedAt).toBe(beforeSync);

  firstRun.close();
  await vi.waitFor(() => {
    expect(sentSteps()).toBe(initialSteps + 1);
  });
  const secondRun = store.beginRun();
  relay.run();
  expect(receivedStepTwos).toBe(initialStepTwos + 1);
  expect(store.isRunning).toBe(true);
  expect(client.lastSyncedAt).toBe(beforeSync);

  relay.sendToAll((name) => encodeUpdateMessage(name, largeUpdate));
  relay.run();
  peer.getMap('meta').set('after-second-overflow', 'second dropped update');
  Y.applyUpdate(relay.doc, Y.encodeStateAsUpdate(peer));
  relay.run();
  expect(client.lastSyncedAt).toBe(beforeSync);

  secondRun.close();
  await vi.waitFor(() => {
    expect(sentSteps()).toBe(initialSteps + 2);
  });
  shouldDelayStatuses = false;
  for (const deliver of delayedStatuses.splice(0)) deliver();
  expect(client.lastSyncedAt).toBe(beforeSync);
  expect(client.status.isAcknowledged).toBe(false);
  expect(store.encodeStateVector()).not.toEqual(Y.encodeStateVector(relay.doc));
  await harness.settle();
  expect(receivedStepTwos).toBe(initialStepTwos + 2);
  expect(store.encodeStateVector()).toEqual(Y.encodeStateVector(relay.doc));
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, store.encodeSyncState(Y.encodeStateVector(recovered)));
  expect(recovered.getMap('meta').get('large-peer-update')).toBe(
    'x'.repeat(MAX_HELD_INBOUND_BYTES / 2 + 1024),
  );
  expect(recovered.getMap('meta').get('after-first-overflow')).toBe('first dropped update');
  expect(recovered.getMap('meta').get('after-second-overflow')).toBe('second dropped update');
  expect(client.status.state).toBe('connected');
  expect(client.lastSyncedAt).toBeGreaterThan(beforeSync);
  expect(client.status.isAcknowledged).toBe(true);
});

it('keeps no frames after overflow while the run is still active', async () => {
  const store = new YjsDocumentStore();
  const apply = vi.fn();
  const hold = new InboundHold(store, { apply, onError: vi.fn() });
  const run = store.beginRun();
  hold.holdUpdate(new Uint8Array(MAX_HELD_INBOUND_BYTES), false);
  expect(hold.isHolding).toBe(true);
  hold.holdUpdate(new Uint8Array(1), false);
  const isHoldingAfterOverflow = hold.isHolding;
  hold.holdUpdate(new Uint8Array(MAX_HELD_INBOUND_BYTES), false);
  const isHoldingAfterLaterFrame = hold.isHolding;
  run.close();
  await store.whenIdle();
  expect(isHoldingAfterOverflow).toBe(false);
  expect(isHoldingAfterLaterFrame).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});

it("ignores a disposed connection's deferred repair mode after reconnecting", async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const client = await harness.connect({ store });
  const repair = vi.spyOn(store, 'setRepairMode');
  const gate = deferred();
  const pending = beginPaste(store, gate);
  harness.relay.sendToAll(() => authFrame(false));
  harness.relay.run();
  expect(repair).not.toHaveBeenCalled();
  harness.relay.drop();
  harness.advance(250);
  expect(client.status.state).toBe('reconnecting');
  expect(harness.relay.received.filter((frame) => frame.kind === 'auth')).toHaveLength(2);
  expect(repair).not.toHaveBeenCalled();
  gate.resolve();
  await pending;
  await harness.settle();
  expect(client.status.state).toBe('connected');
  expect(repair).toHaveBeenCalledTimes(1);
});
