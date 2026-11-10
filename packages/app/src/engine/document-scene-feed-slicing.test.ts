import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { SceneChangeSet } from '@canvas/engine';
import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { DocumentHitIndex } from './document-hit-index.js';
import { DocumentSceneFeed, type SceneChangeSink } from './document-scene-feed.js';

const id = (value: string): ObjectId => value as ObjectId;

/**
 * A 10 × 10 rectangle.
 *
 * @param name - Its id.
 * @param x - Its left, world units.
 * @param parentId - Its parent.
 * @returns The shape.
 */
function shape(name: string, x: number, parentId: ObjectId | null = null): BoardObject {
  return {
    id: id(name),
    type: 'shape',
    parentId,
    x,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:slicing' as PrincipalId,
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

describe('DocumentSceneFeed sliced attach', () => {
  it('sends an owed frame before a child created or moved under it during a yield', async () => {
    const frame: BoardObject = {
      id: id('frame'),
      type: 'frame',
      parentId: null,
      x: 500,
      y: 0,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:slicing' as PrincipalId,
      createdAt: 1,
      updatedAt: 1,
      width: 20,
      height: 20,
      name: 'Frame',
      clip: false,
      background: null,
    };
    const store = new YjsDocumentStore();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape('seen', 0));
      for (let index = 0; index < 6; index += 1)
        transaction.setObject(shape(`far-${String(index)}`, 1_000 + index * 20));
      transaction.setObject(frame);
    });
    const feed = new DocumentSceneFeed(store, store, new DocumentHitIndex(store), vi.fn());
    const sent: ObjectId[] = [];
    const sink: SceneChangeSink = {
      enqueue: (changes: SceneChangeSet) => {
        for (const objectId of [...changes.created, ...changes.updated]) {
          const parentId = changes.get(objectId)?.parentId;
          if (parentId !== null && parentId !== undefined) expect(sent).toContain(parentId);
          sent.push(objectId);
        }
      },
    };
    const resumes: (() => void)[] = [];
    const attached = feed.attach(sink, [], {
      viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      yieldToBrowser: () => new Promise<void>((resolve) => resumes.push(resolve)),
      sliceSize: 2,
    });
    expect(sent).toEqual([id('seen')]);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape('kid', 505, frame.id));
      transaction.setObject({ ...shape('seen', 0), parentId: frame.id });
    });
    expect(sent.slice(1)).toEqual([id('frame'), id('kid'), id('seen')]);
    while (resumes.length > 0) {
      resumes.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await attached;
    expect(new Set(sent)).toEqual(new Set(store.read().objects.keys()));
    expect(sent).toHaveLength(store.read().objects.size + 1);
    feed.destroy();
    store.destroy();
  });

  it('sends an owed frame before a preview-only object under it', () => {
    const store = new YjsDocumentStore();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(shape('seen', 0));
      for (let index = 0; index < 4; index += 1)
        transaction.setObject(shape(`far-${String(index)}`, 1_000 + index * 20));
      transaction.setObject({ ...shape('holder', 2_000) });
    });
    const previews = new Map<ObjectId, BoardObject>();
    const source = { get: (objectId: ObjectId) => previews.get(objectId) ?? store.get(objectId) };
    const feed = new DocumentSceneFeed(store, source, new DocumentHitIndex(store), vi.fn());
    const sent: ObjectId[] = [];
    void feed.attach(
      {
        enqueue: (changes: SceneChangeSet) => {
          sent.push(...changes.created, ...changes.updated);
        },
      },
      [],
      {
        viewport: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        yieldToBrowser: () => new Promise<void>(() => undefined),
        sliceSize: 2,
      },
    );
    previews.set(id('ghost'), shape('ghost', 2_005, id('holder')));
    feed.previewChanged([id('ghost')]);
    expect(sent).toEqual([id('seen'), id('holder'), id('ghost')]);
    feed.destroy();
    store.destroy();
  });
});
