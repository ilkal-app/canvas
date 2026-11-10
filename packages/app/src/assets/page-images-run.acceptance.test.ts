import { expect, it, vi } from 'vitest';

import { createObjectsCommand, runCommand, YjsDocumentStore } from '@canvas/document';
import type { NewObject } from '@canvas/document';
import type { ObjectId, PageId, PrincipalId } from '@canvas/schema';

import { PageIndex } from '../pages/page-index.js';
import { PageScopedStore } from '../pages/page-scoped-store.js';

import { settle } from './__fixtures__/manual-schedule.js';
import { png, setUp } from './__fixtures__/page-images-setup.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = {
  clock: () => 1,
  createId: (() => {
    let next = 0;
    return () => `image-${String(++next)}` as ObjectId;
  })(),
};

it('waits after preparation to insert through a forwarding page store, once and with both images', async () => {
  const root = new YjsDocumentStore();
  const page = new PageScopedStore(root, new PageIndex(root), 'page-1' as PageId);
  const { images, toAdapter } = setUp();
  const writes = vi.fn();
  const notify = vi.fn();
  const target = {
    store: page,
    createObjects: (
      objects: readonly NewObject[],
      onCreated?: (ids: readonly ObjectId[]) => void,
    ) => {
      const outcome = runCommand(
        page,
        ORIGIN,
        createObjectsCommand,
        { objects: [...objects] },
        ENVIRONMENT,
      );
      if (outcome.status !== 'applied') return false;
      writes();
      onCreated?.(outcome.result.ids);
      return true;
    },
    notify,
  };
  const run = root.beginRun();
  const inserting = images.insert([png(1).file, png(2).file], { x: 0, y: 0 }, target);
  const result = inserting.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => {
      expect(toAdapter.filter(({ type }) => type === 'local-image')).toHaveLength(2);
    });
    await settle();
    expect(writes).not.toHaveBeenCalled();
    expect(root.read().objects.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  } finally {
    run.close();
  }
  expect(await result).toBeUndefined();
  expect(writes).toHaveBeenCalledOnce();
  expect(
    [...root.read().objects.values()].map((object) => [
      object.type,
      object.type === 'image' ? object.assetId : undefined,
    ]),
  ).toEqual([
    ['image', png(1).assetId],
    ['image', png(2).assetId],
  ]);
  images.destroy();
  page.destroy();
  root.destroy();
});

it('drops a prepared image when its destination page is deleted during the run', async () => {
  const root = new YjsDocumentStore();
  root.transact(ORIGIN, (tx) => {
    tx.setPage(
      { id: 'page-2' as PageId, name: 'Other', order: 'a1' },
      {
        createdBy: ORIGIN.principalId,
        createdAt: 1,
      },
    );
  });
  const page = new PageScopedStore(root, new PageIndex(root), 'page-1' as PageId);
  const { images, toAdapter } = setUp();
  const writes = vi.fn();
  const target = {
    store: page,
    pageId: 'page-1' as PageId,
    createObjects: writes,
    notify: vi.fn(),
  };
  const run = root.beginRun();
  const inserting = images.insert([png(3).file], { x: 0, y: 0 }, target);
  const result = inserting.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.waitFor(() => {
    expect(toAdapter.some(({ type }) => type === 'local-image')).toBe(true);
  });
  await settle();
  expect(writes).not.toHaveBeenCalled();
  run.enter(() => root.transact(ORIGIN, (tx) => tx.deletePage('page-1' as PageId)));
  run.close();
  expect(await result).toBeUndefined();
  expect(writes).not.toHaveBeenCalled();
  expect(root.read().objects.size).toBe(0);
  images.destroy();
  page.destroy();
  root.destroy();
});
