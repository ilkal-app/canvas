import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  DOCUMENT_LAYOUT_VERSION,
  UpdateDepthError,
  YjsDocumentStore,
  type DocumentStore,
} from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { BOARD as CLIENT_BOARD, ClientHarness } from '../client/__fixtures__/client-harness.js';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { CacheRestoreVersionError } from './cache-restore-version-error.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryDocumentCache } from './memory-document-cache.js';
import { snapshotDigest, type SnapshotStamp } from './snapshot-stamp.js';

const BOARD = 'restore-yields';

function snapshot(id: string): Uint8Array {
  const source = new YjsDocumentStore();
  source.transact(ADA, (transaction) => {
    transaction.setObject(sticky(id));
  });
  const bytes = source.encodeState();
  source.destroy();
  return bytes;
}

function stamp(bytes: Uint8Array): SnapshotStamp {
  return {
    digest: snapshotDigest(bytes),
    layoutVersion: DOCUMENT_LAYOUT_VERSION,
    schemaVersion: SCHEMA_VERSION,
  };
}

function tooDeepSnapshot(): Uint8Array {
  const doc = new Y.Doc();
  let value: unknown = 'leaf';
  for (let index = 0; index < 129; index += 1) value = { child: value };
  doc.getMap('auxiliary').set('value', value);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

async function expectCleanFailure(
  bytes: Uint8Array,
  isStamped: boolean,
  errorType: typeof UpdateDepthError | typeof CacheRestoreVersionError,
): Promise<void> {
  const cache = new MemoryDocumentCache();
  await cache.compact(BOARD, bytes, isStamped ? stamp(bytes) : undefined);
  const store = new YjsDocumentStore();
  const before = store.encodeState();
  await expect(
    DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      yieldToBrowser: () => Promise.resolve(),
    }),
  ).rejects.toBeInstanceOf(errorType);
  expect(store.encodeState()).toEqual(before);
  expect(store.read().objects.size).toBe(0);
  store.destroy();
}

describe('yielding cache restore acceptance', () => {
  it('receives the collab client scheduling option', async () => {
    const cache = new MemoryDocumentCache();
    const bytes = snapshot('client');
    await cache.compact(CLIENT_BOARD, bytes, stamp(bytes));
    const harness = new ClientHarness();
    const store = new YjsDocumentStore();
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    try {
      await harness.open({ store, cache, yieldToBrowser });
      expect(yieldToBrowser).toHaveBeenCalled();
      expect(store.read().objects.has('client' as never)).toBe(true);
    } finally {
      harness.destroy();
    }
  });

  it('restores the snapshot and merged tail in steps with yields before and between them', async () => {
    const cache = new MemoryDocumentCache();
    const first = snapshot('first');
    await cache.compact(BOARD, first, stamp(first));
    const writer = new YjsDocumentStore();
    writer.applyUpdate(first, { kind: 'system', principalId: 'system' as never });
    const before = writer.encodeStateVector();
    writer.transact(ADA, (transaction) => {
      transaction.setObject(sticky('second'));
    });
    await cache.append(BOARD, writer.encodeState(before));
    writer.destroy();
    const store = new YjsDocumentStore();
    const stepped = store as YjsDocumentStore & {
      applyUpdateInSteps(
        update: Uint8Array,
        origin: Parameters<DocumentStore['applyUpdate']>[1],
        options: { readonly isSilent?: boolean; readonly yieldToBrowser: () => Promise<void> },
      ): Promise<void>;
    };
    const originalApply = stepped.applyUpdateInSteps.bind(store);
    const events: string[] = [];
    const applied = vi.spyOn(stepped, 'applyUpdateInSteps').mockImplementation(async (...args) => {
      events.push('begin');
      await originalApply(...args);
      events.push('end');
    });
    const sizes: number[] = [];
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      yieldToBrowser: () => {
        events.push('yield');
        sizes.push(store.read().objects.size);
        return Promise.resolve();
      },
    });
    expect(applied).toHaveBeenCalledTimes(2);
    expect(applied.mock.calls.map((call) => call[2].isSilent)).toEqual([true, true]);
    expect(sizes.length).toBeGreaterThanOrEqual(6);
    expect(sizes[0]).toBe(0);
    expect(sizes).toContain(1);
    expect(events[0]).toBe('yield');
    expect(events.slice(events.indexOf('end') + 1, events.lastIndexOf('begin'))).toContain('yield');
    expect(store.read().objects.size).toBe(2);
    binding.destroy();
    store.destroy();
  });

  it.each([true, false])(
    'rejects an over-depth snapshot with a clean real store (stamped=%s)',
    async (isStamped) => {
      await expectCleanFailure(tooDeepSnapshot(), isStamped, UpdateDepthError);
    },
  );

  it('keeps an unreadable cache out of the real store', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, snapshot('unreadable'));
    doc.getMap('meta').set('document', {
      layoutVersion: DOCUMENT_LAYOUT_VERSION + 1,
      schemaVersion: SCHEMA_VERSION + 1,
    });
    const bytes = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    await expectCleanFailure(bytes, false, CacheRestoreVersionError);
  });

  it('restores through applyUpdate when a store has no stepped method', async () => {
    const cache = new MemoryDocumentCache();
    const bytes = snapshot('fallback');
    await cache.compact(BOARD, bytes, stamp(bytes));
    const real = new YjsDocumentStore();
    const applied = vi.spyOn(real, 'applyUpdate');
    const store: DocumentStore = new Proxy(real, {
      get(target, property) {
        if (property === 'applyUpdateInSteps') return undefined;
        const value: unknown = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      yieldToBrowser,
    });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(yieldToBrowser).toHaveBeenCalled();
    expect(real.read().objects.has('fallback' as never)).toBe(true);
    binding.destroy();
    real.destroy();
  });
});
