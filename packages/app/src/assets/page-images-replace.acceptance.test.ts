import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ImageObject, ObjectId, PrincipalId } from '@canvas/schema';

import { png, setUp } from './__fixtures__/page-images-setup.js';
import type { ReplacementAsset } from './page-images.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ID = 'target' as ObjectId;

it('waits to replace an image after preparation and rechecks the target at replay', async () => {
  const store = new YjsDocumentStore();
  const original = png(4);
  const replacement = png(5);
  const image: ImageObject = {
    id: ID,
    type: 'image',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 400,
    height: 200,
    assetId: original.assetId,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 400, height: 200 },
    opacity: 1,
  };
  store.transact(ORIGIN, (tx) => {
    tx.setObject(image);
  });
  const { images, toAdapter } = setUp();
  const writes = vi.fn();
  const notify = vi.fn();
  const apply = (asset: ReplacementAsset) => {
    if (store.get(ID) === undefined) return undefined;
    store.transact(ORIGIN, (tx) => {
      tx.patchObject(ID, { assetId: asset.assetId });
    });
    writes();
    return [ID];
  };
  // The replacement's document is explicit: the file preparer itself has no document store.
  const replace = images.replace.bind(images) as (
    file: File,
    write: typeof apply,
    notice: typeof notify,
    document: YjsDocumentStore,
  ) => Promise<void>;
  const run = store.beginRun();
  const replacing = replace(replacement.file, apply, notify, store);
  const result = replacing.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => {
      expect(toAdapter.some(({ type }) => type === 'local-image')).toBe(true);
    });
    await Promise.resolve();
    expect(writes).not.toHaveBeenCalled();
    expect((store.get(ID) as ImageObject).assetId).toBe(original.assetId);
  } finally {
    run.close();
  }
  expect(await result).toBeUndefined();
  expect((store.get(ID) as ImageObject).assetId).toBe(replacement.assetId);
  expect(writes).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
  images.destroy();
  store.destroy();
});
