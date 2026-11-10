import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { addStickies } from '../cache/__fixtures__/sticky-board.js';

import { ClientHarness } from './__fixtures__/client-harness.js';

const harness = new ClientHarness();
afterEach(() => {
  harness.destroy();
});

it('does not encode or send recovery when a peer update releases no cached clocks', async () => {
  const writer = new Y.Doc();
  writer.getText('note').insert(0, 'a');
  const vector = Y.encodeStateVector(writer);
  writer.getText('note').insert(1, 'b');
  const retained = new YjsDocumentStore();
  retained.applyUpdate(Y.encodeStateAsUpdate(writer, vector), SYSTEM_ORIGIN);
  const client = await harness.connect({ store: retained });
  const peer = new YjsDocumentStore();
  await harness.connect({ store: peer });
  const encode = vi.spyOn(retained, 'encodeSyncState');
  const counts: number[] = [];
  client.subscribe((status) => counts.push(status.pendingUpdateCount));
  const before = harness.relay.received.filter((frame) => frame.kind === 'update').length;
  addStickies(peer, 3, { batchSize: 1 });
  harness.relay.run();
  expect(retained.hasPendingStructs).toBe(true);
  expect(retained.read().objects.size).toBe(3);
  expect(encode).not.toHaveBeenCalled();
  expect(counts.every((count) => count === 0)).toBe(true);
  expect(harness.relay.received.filter((frame) => frame.kind === 'update')).toHaveLength(
    before + 3,
  );
  writer.destroy();
});
