import { expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { settle } from './__fixtures__/manual-schedule.js';
import { png, setUp } from './__fixtures__/page-images-setup.js';
import type { ImageInsertTarget } from './page-images-types.js';

it('starts an upload only after the create callback supplies the new object ids', async () => {
  const { images, service } = setUp();
  const prepared = png(5);
  let onCreated: ((ids: readonly ObjectId[]) => void) | undefined;
  const createObjects = (
    objects: readonly NewObject[],
    callback?: (ids: readonly ObjectId[]) => void,
  ): boolean => {
    expect(objects).toHaveLength(1);
    onCreated = callback;
    return true;
  };
  const target = {
    createObjects,
    notify: () => undefined,
  } as unknown as ImageInsertTarget;
  await images.insert([prepared.file], { x: 0, y: 0 }, target);
  expect(onCreated).toBeDefined();
  expect(service.requests).toEqual([]);
  onCreated?.(['placed-image' as ObjectId]);
  await settle();
  expect(service.isLinked(prepared.assetId, 'board-a')).toBe(true);
  images.destroy();
});

it('does not upload if the create seam refuses immediately', async () => {
  const { images, service } = setUp();
  const target = {
    createObjects: () => false,
    notify: () => undefined,
  } as unknown as ImageInsertTarget;
  await images.insert([png(6).file], { x: 0, y: 0 }, target);
  await settle();
  expect(service.requests).toEqual([]);
  images.destroy();
});
