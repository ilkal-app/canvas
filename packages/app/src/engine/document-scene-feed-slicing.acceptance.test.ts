import { describe, expect, it, vi } from 'vitest';

import { createHistory, SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { SceneChangeSet, SceneSource, WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { DocumentHitIndex } from './document-hit-index.js';
import { DocumentSceneFeed, type SceneChangeSink } from './document-scene-feed.js';
import { EngineDocument, type EngineDocumentView } from './engine-document.js';

const VIEWPORT: WorldBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const id = (value: string): ObjectId => value as ObjectId;
const principalId = 'user:acceptance' as PrincipalId;

// Mirrors the proposed public contract while the implementation has not exported it yet.
interface SceneAttachSlicing {
  readonly viewport: WorldBounds;
  readonly yieldToBrowser: () => Promise<void>;
  readonly afterSlice?: () => void;
  readonly sliceSize?: number;
}

function attachFeed(
  feed: DocumentSceneFeed,
  sink: SceneChangeSink,
  previousIds: readonly ObjectId[],
  slicing?: SceneAttachSlicing,
): Promise<void> {
  const attach = feed.attach.bind(feed) as unknown as (
    renderer: SceneChangeSink,
    ids: readonly ObjectId[],
    options?: SceneAttachSlicing,
  ) => Promise<void>;
  return attach(sink, previousIds, slicing);
}

function attachDocument(
  document: EngineDocument,
  view: EngineDocumentView,
  slicing: SceneAttachSlicing,
): Promise<void> {
  const attach = document.attach.bind(document) as unknown as (
    target: EngineDocumentView,
    ids: readonly ObjectId[],
    options: SceneAttachSlicing,
  ) => Promise<void>;
  return attach(view, [], slicing);
}

function shape(name: string, x: number, y = 0, parentId: ObjectId | null = null): BoardObject {
  return {
    id: id(name),
    type: 'shape',
    parentId,
    x,
    y,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 10,
    height: 10,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

function board(): BoardObject[] {
  const frame: BoardObject = {
    id: id('frame'),
    type: 'frame',
    parentId: null,
    x: 200,
    y: 200,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 20,
    height: 20,
    name: 'Frame',
    clip: false,
    background: null,
  };
  const objects: BoardObject[] = [
    frame,
    shape('visible-child', -195, -195, frame.id),
    shape('offscreen-child', 30, 30, frame.id),
  ];
  for (let index = 0; index < 9; index += 1) {
    objects.push(shape(`root-${String(index)}`, 300 + index * 20));
  }
  return objects;
}

interface RecordedSlice {
  readonly created: readonly ObjectId[];
  readonly updated: readonly ObjectId[];
  readonly deleted: readonly ObjectId[];
  readonly objects: ReadonlyMap<ObjectId, BoardObject | undefined>;
}

function recorder(): { sink: SceneChangeSink; slices: RecordedSlice[] } {
  const slices: RecordedSlice[] = [];
  const sink: SceneChangeSink = {
    enqueue(changes: SceneChangeSet) {
      const created = [...changes.created];
      const updated = [...changes.updated];
      const deleted = [...changes.deleted];
      const objects = new Map(
        [...created, ...updated].map((objectId) => [objectId, changes.get(objectId)] as const),
      );
      slices.push({ created, updated, deleted, objects });
    },
  };
  return { sink, slices };
}

function controlledYield() {
  const pending: (() => void)[] = [];
  const yieldToBrowser = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
  async function resume(): Promise<void> {
    const resolve = pending.shift();
    if (resolve === undefined) throw new Error('No pending browser yield');
    resolve();
    await Promise.resolve();
  }
  return { yieldToBrowser, pending, resume };
}

function setUp() {
  const store = new YjsDocumentStore();
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of board()) transaction.setObject(object);
  });
  const source: SceneSource = { get: (objectId) => store.get(objectId) };
  const feed = new DocumentSceneFeed(store, source, new DocumentHitIndex(store), vi.fn());
  const { sink, slices } = recorder();
  const yieldControl = controlledYield();
  const afterSlice = vi.fn();
  const slicing: SceneAttachSlicing = {
    viewport: VIEWPORT,
    yieldToBrowser: yieldControl.yieldToBrowser,
    afterSlice,
    sliceSize: 3,
  };
  return { store, feed, sink, slices, yieldControl, afterSlice, slicing };
}

function sentIds(slices: readonly RecordedSlice[]): ObjectId[] {
  return slices.flatMap(({ created, updated }) => [...created, ...updated]);
}

describe('DocumentSceneFeed attach slicing', () => {
  it('keeps the unsliced and small-document attach synchronous, with one complete change set', async () => {
    const large = setUp();
    const previous = [id('frame'), id('cached-only')];
    const unsliced = attachFeed(large.feed, large.sink, previous);
    expect(large.slices).toHaveLength(1);
    expect(large.slices[0]?.created).toEqual(
      [...large.store.read().objects.keys()].filter((objectId) => objectId !== id('frame')),
    );
    expect(large.slices[0]?.updated).toEqual([id('frame')]);
    expect(large.slices[0]?.deleted).toEqual([id('cached-only')]);
    expect(unsliced).toBeInstanceOf(Promise);
    await unsliced;

    const small = setUp();
    const complete = attachFeed(small.feed, small.sink, previous, {
      ...small.slicing,
      sliceSize: small.store.read().objects.size,
    });
    expect(small.slices).toHaveLength(1);
    expect(small.yieldControl.yieldToBrowser).not.toHaveBeenCalled();
    expect(small.afterSlice).not.toHaveBeenCalled();
    await complete;
    large.feed.destroy();
    small.feed.destroy();
    large.store.destroy();
    small.store.destroy();
  });

  it('sends viewport hits and their ancestors first, then bounded document-order slices after yields', async () => {
    const { store, feed, sink, slices, yieldControl, afterSlice, slicing } = setUp();
    const previous = [id('root-0'), id('cached-only')];
    const attached = attachFeed(feed, sink, previous, slicing);
    const hits = feed.hitIndex.searchRect(VIEWPORT);
    expect(hits).toContain(id('visible-child'));
    expect(hits).not.toContain(id('frame'));
    expect(slices).toHaveLength(1);
    expect(sentIds(slices)).toEqual([id('frame'), id('visible-child')]);
    expect(slices[0]?.deleted).toEqual([id('cached-only')]);
    expect(afterSlice).toHaveBeenCalledTimes(1);
    expect(yieldControl.yieldToBrowser).toHaveBeenCalledTimes(1);

    while (yieldControl.pending.length > 0) await yieldControl.resume();
    await attached;
    const order = [...store.read().objects.keys()];
    expect(slices.flatMap((slice) => slice.created)).toEqual(
      order.filter((objectId) => objectId !== id('root-0')),
    );
    expect(new Set(sentIds(slices))).toEqual(new Set(order));
    expect(slices.slice(1).every((slice) => slice.created.length + slice.updated.length <= 3)).toBe(
      true,
    );
    expect(slices.flatMap((slice) => slice.updated)).toEqual([id('root-0')]);
    expect(slices.slice(1).every((slice) => slice.deleted.length === 0)).toBe(true);
    expect(afterSlice).toHaveBeenCalledTimes(slices.length);
    const alreadySent = new Set<ObjectId>();
    for (const slice of slices) {
      const current = new Set([...slice.created, ...slice.updated]);
      for (const objectId of current) {
        const parentId = slice.objects.get(objectId)?.parentId;
        if (parentId !== null && parentId !== undefined) {
          expect(current.has(parentId) || alreadySent.has(parentId)).toBe(true);
        }
      }
      for (const objectId of current) alreadySent.add(objectId);
    }
    feed.destroy();
    store.destroy();
  });

  it('sends intervening edits once, omits unseen deletions, and updates already-sent objects', async () => {
    const { store, feed, sink, slices, yieldControl, slicing } = setUp();
    const attached = attachFeed(feed, sink, [], slicing);
    expect(slices).toHaveLength(1);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(id('root-0'), { x: 500 });
    });
    expect(slices.at(-1)?.created).toContain(id('root-0'));
    expect(slices.at(-1)?.objects.get(id('root-0'))?.x).toBe(500);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(id('root-1'));
    });
    expect(slices.at(-1)?.deleted).not.toContain(id('root-1'));
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape('new-object', 600));
    });
    expect(slices.at(-1)?.created).toContain(id('new-object'));
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(id('visible-child'), { x: -190 });
    });
    expect(slices.at(-1)?.updated).toContain(id('visible-child'));
    while (yieldControl.pending.length > 0) await yieldControl.resume();
    await attached;
    expect(sentIds(slices).filter((objectId) => objectId === id('root-0'))).toEqual([id('root-0')]);
    expect(sentIds(slices)).not.toContain(id('root-1'));
    expect(slices.flatMap((slice) => slice.deleted)).not.toContain(id('root-1'));
    feed.destroy();
    store.destroy();
  });

  it('treats previousIds as already present for intervening updates and deletions', async () => {
    const { store, feed, sink, slices, yieldControl, slicing } = setUp();
    const attached = attachFeed(feed, sink, [id('root-0'), id('root-1')], slicing);
    expect(slices).toHaveLength(1);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.patchObject(id('root-0'), { x: 700 });
    });
    expect(slices.at(-1)?.created).not.toContain(id('root-0'));
    expect(slices.at(-1)?.updated).toContain(id('root-0'));
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(id('root-1'));
    });
    expect(slices.at(-1)?.deleted).toContain(id('root-1'));
    while (yieldControl.pending.length > 0) await yieldControl.resume();
    await attached;
    expect(sentIds(slices).filter((objectId) => objectId === id('root-0'))).toEqual([id('root-0')]);
    expect(sentIds(slices)).not.toContain(id('root-1'));
    feed.destroy();
    store.destroy();
  });

  it('settles attach without another enqueue or callback when destroyed during a yield', async () => {
    const { store, feed, sink, slices, yieldControl, afterSlice, slicing } = setUp();
    const attached = attachFeed(feed, sink, [], slicing);
    expect(slices).toHaveLength(1);
    expect(yieldControl.pending).toHaveLength(1);
    feed.destroy();
    await yieldControl.resume();
    await attached;
    expect(slices).toHaveLength(1);
    expect(afterSlice).toHaveBeenCalledTimes(1);
    store.destroy();
  });
});

it('EngineDocument forwards attach slicing to its scene feed', async () => {
  const { store, slicing, yieldControl } = setUp();
  const history = createHistory(store, principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: { kind: 'user', principalId },
    environment: { clock: () => 1, createId: () => id('unused') },
    onChange: vi.fn(),
  });
  const slices: SceneChangeSet[] = [];
  const view: EngineDocumentView = {
    enqueue: (changes) => slices.push(changes),
    showOverlay: () => undefined,
  };
  const attached = attachDocument(document, view, slicing);
  expect(slices).toHaveLength(1);
  expect(slices[0]?.created).toEqual([id('frame'), id('visible-child')]);
  while (yieldControl.pending.length > 0) await yieldControl.resume();
  await attached;
  expect(sentIds(slices.map((slice) => ({ ...slice, objects: new Map() })))).toHaveLength(
    store.read().objects.size,
  );
  document.destroy();
  store.destroy();
});
