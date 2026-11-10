// The collab client leaves at most MAX_UNACKNOWLEDGED_BYTES of sync messages (or one
// larger message alone) unacknowledged on a connection, sends a live transaction whole up to
// SINGLE_TRANSACTION_BYTES and cuts a larger one by struct ranges (warning once), and stops for
// good when the relay closes it for a frame past its limit (a single struct too large to split),
// instead of resending it forever.
import * as decoding from 'lib0/decoding';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createLargeBoardObjects, SYSTEM_ORIGIN, type YjsDocumentStore } from '@canvas/document';

import { OUTBOUND_CHUNK_BYTES } from '../chunking/split-update.js';
import { SINGLE_TRANSACTION_BYTES } from '../chunking/transaction-chunks.js';

import {
  FRAMING_BYTES,
  sizesOf,
  writeObjects,
  writerStore,
} from './__fixtures__/chunking-fixtures.js';
import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { MAX_UNACKNOWLEDGED_BYTES } from './chunk-window.js';
import type { CollabSocketFactory } from './collab-socket.js';
import { decodeRelayMessage, RELAY_MESSAGE_TYPES } from './relay-protocol.js';
import { UnsentChangesSplitWarning } from './unsent-changes-split-warning.js';
import { UPDATE_TOO_LARGE_REASON } from './update-too-large.js';

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * Whether a frame the client sends is a sync step 2 or a live update: a message the relay
 * acknowledges.
 *
 * @param frame - The frame.
 * @returns `true` for a step 2 or an update.
 */
function isAcknowledgedKind(frame: Uint8Array): boolean {
  const decoder = decoding.createDecoder(frame);
  decoding.readVarString(decoder);
  if (decoding.readVarUint(decoder) !== RELAY_MESSAGE_TYPES.sync) return false;
  return decoding.readVarUint(decoder) !== 0;
}

/**
 * A transport over the fake relay that measures the sync messages not yet acknowledged.
 *
 * @param base - The fake relay's factory.
 * @returns The factory; the most bytes unacknowledged at once while more than one message was;
 *   the most messages unacknowledged at once.
 */
function countingTransport(base: CollabSocketFactory): {
  readonly factory: CollabSocketFactory;
  readonly mostSharedBytes: () => number;
  readonly mostMessages: () => number;
} {
  let inFlight: number[] = [];
  let mostSharedBytes = 0;
  let mostMessages = 0;
  const factory: CollabSocketFactory = (url, handlers) => {
    inFlight = [];
    const socket = base(url, {
      ...handlers,
      onMessage: (data) => {
        if (decodeRelayMessage(data, BOARD).kind === 'sync-status') inFlight.shift();
        handlers.onMessage(data);
      },
    });
    return {
      send: (data) => {
        if (isAcknowledgedKind(data)) {
          inFlight.push(data.byteLength);
          mostMessages = Math.max(mostMessages, inFlight.length);
          const bytes = inFlight.reduce((sum, size) => sum + size, 0);
          if (inFlight.length > 1) mostSharedBytes = Math.max(mostSharedBytes, bytes);
        }
        socket.send(data);
      },
      close: () => {
        socket.close();
      },
    };
  };
  return { factory, mostSharedBytes: () => mostSharedBytes, mostMessages: () => mostMessages };
}

/**
 * Writes `count` stickies of `textLength` characters each in one transaction.
 *
 * @param store - The store.
 * @param count - How many.
 * @param textLength - Characters of each one's text.
 * @throws {Error} When the fixture board has no sticky to copy.
 */
function writeLongNotes(store: YjsDocumentStore, count: number, textLength: number): void {
  const sticky = createLargeBoardObjects(100, 9).find((object) => object.type === 'sticky');
  if (sticky?.type !== 'sticky') throw new Error('the fixture has stickies');
  const style = sticky.runs[0]?.style;
  if (style === undefined) throw new Error('the fixture sticky has runs');
  const text = 'x'.repeat(textLength);
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (let index = 0; index < count; index += 1) {
      const id = `${sticky.id}${String(textLength)}n${String(index)}` as typeof sticky.id;
      const runs = [{ length: text.length, style }];
      transaction.setObject({ ...sticky, id, parentId: null, text, runs });
    }
  });
}

describe('CollabClient pacing and limits', { timeout: 30_000 }, () => {
  it('never leaves more than 4 MiB unacknowledged on a connection', async () => {
    harness = new ClientHarness();
    const transport = countingTransport(harness.relay.socketFactory);
    const store = writerStore();
    const client = await harness.connect({ store, socketFactory: transport.factory });
    client.disconnect();
    writeObjects(store, 9_000, 500);
    client.connect();
    harness.relay.run();
    expect(sizesOf(harness.relay, 'sync-step-2', 2).length).toBeGreaterThan(4);
    expect(transport.mostMessages()).toBeGreaterThan(1);
    expect(transport.mostSharedBytes()).toBeGreaterThan(MAX_UNACKNOWLEDGED_BYTES / 2);
    expect(transport.mostSharedBytes()).toBeLessThanOrEqual(MAX_UNACKNOWLEDGED_BYTES);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(client.status.pendingUpdateCount).toBe(0);
  });

  it('sends a live transaction larger than a chunk whole, in one message', async () => {
    harness = new ClientHarness();
    const store = writerStore();
    const errors: unknown[] = [];
    const client = await harness.connect({ store, onError: (error) => errors.push(error) });
    writeObjects(store, 2_000, 2_000);
    expect(client.status.pendingUpdateCount).toBe(1);
    harness.relay.run();
    const updates = sizesOf(harness.relay, 'update', 1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBeGreaterThan(OUTBOUND_CHUNK_BYTES);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(client.status.pendingUpdateCount).toBe(0);
    expect(errors).toEqual([]);
  });

  it('cuts only a transaction above 7 MiB by struct ranges, and warns once', async () => {
    harness = new ClientHarness();
    const store = writerStore();
    const errors: unknown[] = [];
    const client = await harness.connect({ store, onError: (error) => errors.push(error) });
    writeLongNotes(store, 80, 100_000);
    writeLongNotes(store, 80, 100_001);
    harness.relay.run();
    const updates = sizesOf(harness.relay, 'update', 1);
    expect(updates.length).toBeGreaterThan(14);
    for (const size of updates)
      expect(size).toBeLessThanOrEqual(OUTBOUND_CHUNK_BYTES + FRAMING_BYTES);
    expect(errors).toEqual([expect.any(UnsentChangesSplitWarning)]);
    expect(Y.encodeStateVector(harness.relay.doc)).toEqual(store.encodeStateVector());
    expect(client.status.pendingUpdateCount).toBe(0);
    expect(SINGLE_TRANSACTION_BYTES).toBe(7 * 1024 * 1024);
  });

  it('stops with update-too-large when the relay refuses a 9 MiB struct, and never resends it', async () => {
    harness = new ClientHarness();
    harness.relay.maxFrameBytes = 8 * 1024 * 1024;
    const store = writerStore();
    const errors: unknown[] = [];
    const client = await harness.connect({ store, onError: (error) => errors.push(error) });
    writeLongNotes(store, 1, 9 * 1024 * 1024);
    harness.relay.run();
    expect(client.status).toMatchObject({
      state: 'outdated',
      rejectionReason: UPDATE_TOO_LARGE_REASON,
    });
    const opened = harness.relay.openedUrls.length;
    harness.advance(60_000);
    expect(harness.relay.openedUrls).toHaveLength(opened);
    expect(client.status.state).toBe('outdated');
    expect(errors).toEqual([expect.any(UnsentChangesSplitWarning)]);
  });
});
