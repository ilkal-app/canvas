import * as encoding from 'lib0/encoding';
import { afterEach, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  createObjectsCommand,
  startRun,
  StoreBusyError,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
} from '@canvas/document';
import { createSeededIdGenerator, type PrincipalId } from '@canvas/schema';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { OutboundQueue } from './outbound-queue.js';
import { RelayConnection } from './relay-connection.js';
import { encodeSyncStep2, encodeUpdateMessage, RELAY_MESSAGE_TYPES } from './relay-protocol.js';

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

it('exposes held inbound state until every queued frame is applied', async () => {
  const store = new YjsDocumentStore();
  const peer = new YjsDocumentStore();
  const updates: Uint8Array[] = [];
  peer.subscribeUpdates(({ update }) => updates.push(update));
  const ids = addStickies(peer, 2, { seed: 559, batchSize: 1 });
  const progress = vi.fn();
  const connection = new RelayConnection(
    {
      documentName: BOARD,
      token: 'test',
      store,
      awareness: new Awareness(new Y.Doc()),
      queue: new OutboundQueue(),
      reportError: vi.fn(),
      onStructRangeSplit: vi.fn(),
      applyRemoteUpdate: (update) => {
        store.applyUpdate(update, SYSTEM_ORIGIN);
      },
      onAuthenticated: vi.fn(),
      onSynced: vi.fn(),
      onProgress: progress,
      onRejected: vi.fn(),
      onClosedByRelay: vi.fn(),
    },
    vi.fn(),
  );
  const run = store.beginRun();
  for (const update of updates) connection.receive(encodeUpdateMessage(BOARD, update));
  expect(connection.hasHeldInbound).toBe(true);
  expect(store.read().objects.size).toBe(0);
  expect(progress).not.toHaveBeenCalled();
  run.close();
  await vi.waitFor(() => {
    expect(connection.hasHeldInbound).toBe(false);
  });
  expect([...store.read().objects.keys()]).toEqual(ids);
  expect(progress).toHaveBeenCalledTimes(2);
});

it('holds several updates in arrival order and does not advance sync on outbound acknowledgements', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const errors: unknown[] = [];
  const client = await harness.connect({ store, onError: (error) => errors.push(error) });
  const beforeSync = client.lastSyncedAt;
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new YjsDocumentStore();
  const applied: string[] = [];
  const updates: Uint8Array[] = [];
  store.subscribe((changes) => {
    if (!changes.isLocal) applied.push(...changes.created);
  });
  peer.subscribeUpdates(({ update }) => updates.push(update));
  const ids = addStickies(peer, 3, { seed: 558, batchSize: 1 });
  for (const update of updates)
    harness.relay.sendToAll((name) => encodeUpdateMessage(name, update));
  harness.time.advanceBy(100);
  harness.relay.run();
  expect(store.isRunning).toBe(true);
  expect(client.status.state).toBe('connected');
  expect(client.lastSyncedAt).toBe(beforeSync);
  expect(applied).toEqual([]);
  expect(errors.some((error) => error instanceof StoreBusyError)).toBe(false);
  gate.resolve();
  await pending;
  await harness.settle();
  expect(applied).toEqual(ids);
  expect(errors).toEqual([]);
});

it('holds sync step 2 and its completion until the document bytes are applied', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const client = await harness.open({ store });
  const gate = deferred();
  const pending = beginPaste(store, gate);
  harness.relay.run();
  expect(client.lastSyncedAt).toBeUndefined();
  expect(client.status.isAcknowledged).toBe(false);
  expect(client.status.state).not.toBe('connected');
  gate.resolve();
  await pending;
  await harness.settle();
  expect(client.status.state).toBe('connected');
  expect(client.lastSyncedAt).toBeTypeOf('number');
});

it('applies permission revocation immediately but stops the run before another part', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const repair = vi.spyOn(store, 'setRepairMode');
  const client = await harness.connect({ store });
  repair.mockClear();
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const committed = store.read().objects.size;
  harness.relay.sendToAll(() => authFrame(true));
  harness.relay.run();
  expect(client.status.isReadOnly).toBe(true);
  expect(store.isRunning).toBe(true);
  expect(client.status.state).toBe('connected');
  expect(repair).not.toHaveBeenCalled();
  gate.resolve();
  await expect(pending).rejects.toMatchObject({
    name: 'RunStoppedError',
    cause: { name: 'RunStopRequest', reason: 'revoked' },
  });
  expect(store.read().objects.size).toBe(committed);
  await store.whenIdle();
  expect(store.isRunning).toBe(false);
  await harness.settle();
  expect(repair).toHaveBeenCalledTimes(1);
});

it('stops a run when held document frames exceed the inbound byte bound', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  await harness.connect({ store });
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('meta').set('large', 'x'.repeat(8 * 1024 * 1024 + 1));
  harness.relay.sendToAll((name) => encodeUpdateMessage(name, Y.encodeStateAsUpdate(peer)));
  peer.getMap('meta').set('small', 'one more frame');
  harness.relay.sendToAll((name) => encodeUpdateMessage(name, Y.encodeStateAsUpdate(peer)));
  harness.relay.run();
  gate.resolve();
  await expect(pending).rejects.toMatchObject({
    name: 'RunStoppedError',
    cause: { name: 'RunStopRequest', reason: 'inbound-backlog' },
  });
});

it('discards old held frames on reconnect and waits until idle for the replacement handshake', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const client = await harness.connect({ store });
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('meta').set('old', 'held');
  harness.relay.sendToAll((name) => encodeUpdateMessage(name, Y.encodeStateAsUpdate(peer)));
  harness.relay.run();
  harness.relay.drop();
  harness.advance(250);
  expect(client.status.state).toBe('reconnecting');
  expect(harness.relay.received.filter((frame) => frame.kind === 'sync-step-1')).toHaveLength(1);
  gate.resolve();
  await pending;
  await harness.settle();
  expect(client.status.state).toBe('connected');
  expect(harness.relay.received.filter((frame) => frame.kind === 'sync-step-1')).toHaveLength(2);
  expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
});

it('detects an incompatible version only when held data drains', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const client = await harness.connect({ store });
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('objects').set('unversioned', new Y.Map([['z', 'a0']]));
  harness.relay.sendToAll((name) => encodeSyncStep2(name, Y.encodeStateAsUpdate(peer)));
  harness.relay.run();
  expect(client.status.state).toBe('connected');
  gate.resolve();
  await pending;
  await harness.settle();
  expect(client.status.state).toBe('outdated');
  expect(client.status.rejectionReason).toBe('unversioned');
});

it('drops held frames without draining or reporting an error when destroyed', async () => {
  harness = new ClientHarness();
  const store = new YjsDocumentStore();
  const onError = vi.fn();
  const client = await harness.connect({ store, onError });
  const gate = deferred();
  const pending = beginPaste(store, gate);
  const peer = new Y.Doc();
  peer.getMap('meta').set('late', 'held');
  harness.relay.sendToAll((name) => encodeUpdateMessage(name, Y.encodeStateAsUpdate(peer)));
  harness.relay.run();
  client.destroy();
  gate.resolve();
  await pending;
  expect(onError).not.toHaveBeenCalled();
});
