import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { OBJECTS_MAP_NAME, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { ADA, sticky } from '../cache/__fixtures__/sticky-board.js';
import { MemoryDocumentCache } from '../cache/memory-document-cache.js';

import { BOARD, ClientHarness } from './__fixtures__/client-harness.js';
import { EDITOR_CLAIMS, unsignedToken } from './__fixtures__/unsigned-token.js';

const NOTE = 'note' as ObjectId;
const harnesses: ClientHarness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.destroy();
});

function seed(parentId: string): Uint8Array {
  const source = new YjsDocumentStore();
  source.transact(ADA, (transaction) => {
    transaction.setObject(sticky(NOTE));
  });
  const raw = new Y.Doc();
  Y.applyUpdate(raw, source.encodeState());
  const note = raw.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(NOTE);
  if (note === undefined) throw new Error('missing fixture note');
  const placement = note.get('placement') as Record<string, unknown>;
  note.set('placement', { ...placement, parentId });
  const bytes = Y.encodeStateAsUpdate(raw);
  source.destroy();
  raw.destroy();
  return bytes;
}

describe('viewer automatic repairs', () => {
  it.each(['gone', NOTE])(
    'syncs a stored %s reference without generating a local update',
    async (parent) => {
      const harness = new ClientHarness();
      harnesses.push(harness);
      harness.relay.isReadOnly = true;
      const bytes = seed(parent);
      Y.applyUpdate(harness.relay.doc, bytes);
      const store = new YjsDocumentStore();
      const local: Uint8Array[] = [];
      store.subscribeUpdates(({ update, isLocal }) => {
        if (isLocal) local.push(update);
      });
      const client = await harness.connect({ store });
      expect(client.status.state).toBe('connected');
      expect(client.status.isReadOnly).toBe(true);
      expect(client.status.pendingUpdateCount).toBe(0);
      expect(store.get(NOTE)?.parentId).toBeNull();
      expect(local).toEqual([]);
      expect(store.encodeState()).toEqual(bytes);
      expect(harness.relay.received.filter(({ kind }) => kind === 'update')).toEqual([]);
    },
  );

  it('selects viewer projection before reading the cache while offline', async () => {
    const harness = new ClientHarness();
    harnesses.push(harness);
    harness.network.set(false);
    const bytes = seed('gone');
    const cache = new MemoryDocumentCache();
    await cache.append(BOARD, bytes);
    const store = new YjsDocumentStore();
    const local: Uint8Array[] = [];
    store.subscribeUpdates(({ update, isLocal }) => {
      if (isLocal) local.push(update);
    });
    await harness.open({
      store,
      cache,
      token: unsignedToken({ ...EDITOR_CLAIMS, role: 'viewer' }),
    });
    expect(store.get(NOTE)?.parentId).toBeNull();
    expect(store.encodeState()).toEqual(bytes);
    expect(local).toEqual([]);
  });

  it('does not throw while reasserting repair policy after a cached version refusal', async () => {
    const harness = new ClientHarness();
    harnesses.push(harness);
    harness.network.set(false);
    const raw = new Y.Doc();
    raw.getMap(OBJECTS_MAP_NAME).set('old-object', new Y.Map([['z', 'a0']]));
    const cache = new MemoryDocumentCache();
    await cache.append(BOARD, Y.encodeStateAsUpdate(raw));
    const errors: unknown[] = [];
    const client = await harness.open({ cache, onError: (error) => errors.push(error) });
    expect(errors).toEqual([]);
    expect(client.recovery?.state.phase).toBe('waiting');
    expect(client.status.state).toBe('offline');
    raw.destroy();
  });

  it('materializes repairs after authoritative viewer-to-editor authentication', async () => {
    const harness = new ClientHarness();
    harnesses.push(harness);
    const bytes = seed('gone');
    Y.applyUpdate(harness.relay.doc, bytes);
    harness.relay.isReadOnly = true;
    const store = new YjsDocumentStore();
    const client = await harness.connect({ store });
    expect(store.encodeState()).toEqual(bytes);
    client.disconnect();
    harness.relay.isReadOnly = false;
    client.connect();
    await harness.settle();
    expect(client.status.pendingUpdateCount).toBe(0);
    expect(store.get(NOTE)?.parentId).toBeNull();
    expect(store.encodeState()).not.toEqual(bytes);
  });
});
