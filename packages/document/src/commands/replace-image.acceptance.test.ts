import { describe, expect, it } from 'vitest';

import type { ImageObject } from '@canvas/schema';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { coverCrop } from '../index.js';
import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { replaceImageCommand } from './replace-image.js';

const IMAGE = id('image-photo');
const NEW_ASSET = 'replacement-asset';

function imageOf(store: ReturnType<typeof createFixtureStore>): ImageObject {
  const object = mustGet(store, IMAGE);
  if (object.type !== 'image') throw new Error('fixture image is missing');
  return object;
}

describe('coverCrop in @canvas/document', () => {
  it('shows the whole image for matching aspects and centres cuts on either axis', () => {
    expect(coverCrop({ width: 400, height: 300 }, { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(coverCrop({ width: 100, height: 100 }, { width: 200, height: 100 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(coverCrop({ width: 100, height: 100 }, { width: 100, height: 200 })).toEqual({
      x: 0,
      y: 0.25,
      width: 1,
      height: 0.5,
    });
  });
});

describe('replaceImage', () => {
  it('replaces asset and natural size, keeps geometry, chooses centred cover crop, and undoes in one step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const before = imageOf(store);
    const snapshot = store.read();
    const { changes } = applyCommand(store, replaceImageCommand, {
      id: IMAGE,
      assetId: NEW_ASSET,
      naturalSize: { width: 2000, height: 1000 },
    });
    const after = imageOf(store);
    expect(after).toMatchObject({
      assetId: NEW_ASSET,
      naturalSize: { width: 2000, height: 1000 },
    });
    expect(after.crop.x).toBeCloseTo(1 / 6, 12);
    expect(after.crop.y).toBe(0);
    expect(after.crop.width).toBeCloseTo(2 / 3, 12);
    expect(after.crop.height).toBe(1);
    expect([after.x, after.y, after.width, after.height, after.rotation]).toEqual([
      before.x,
      before.y,
      before.width,
      before.height,
      before.rotation,
    ]);
    expectDiff(snapshot, store.read(), changes, { updated: ['image-photo'] });
    expect(history.undo()).toBe(true);
    expect(imageOf(store)).toEqual(before);
    expect(history.undo()).toBe(false);
  });

  it('keeps a custom crop when it has the new image aspect within 1% of the box aspect', () => {
    const store = createFixtureStore();
    const oldCrop = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
    store.transact(ADA, (transaction) => {
      transaction.patchObject(IMAGE, { crop: oldCrop });
    });
    applyCommand(store, replaceImageCommand, {
      id: IMAGE,
      assetId: NEW_ASSET,
      naturalSize: { width: 1000, height: 1000 },
    });
    expect(imageOf(store).crop).toEqual(oldCrop);
  });

  it('replaces an incompatible crop with whole image when the shapes match', () => {
    const store = createFixtureStore();
    applyCommand(store, replaceImageCommand, {
      id: IMAGE,
      assetId: NEW_ASSET,
      naturalSize: { width: 800, height: 600 },
    });
    expect(imageOf(store).crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('refuses unknown fields, invalid image data, missing, non-image and locked objects without writing', () => {
    const store = createFixtureStore();
    const codes = (input: unknown) =>
      expectRejected(store, replaceImageCommand, input).map((error) => error.code);
    expect(
      codes({
        id: IMAGE,
        assetId: NEW_ASSET,
        naturalSize: { width: 100, height: 100 },
        extra: true,
      }),
    ).toContain('invalid-input');
    for (const assetId of ['', 'has space'])
      expect(codes({ id: IMAGE, assetId, naturalSize: { width: 100, height: 100 } })).toContain(
        'invalid-input',
      );
    for (const width of [0, -1, 1.5])
      expect(
        codes({ id: IMAGE, assetId: NEW_ASSET, naturalSize: { width, height: 100 } }),
      ).toContain('invalid-input');
    expect(
      codes({ id: id('missing'), assetId: NEW_ASSET, naturalSize: { width: 100, height: 100 } }),
    ).toContain('missing-object');
    expect(
      codes({ id: id('frame-plan'), assetId: NEW_ASSET, naturalSize: { width: 100, height: 100 } }),
    ).toContain('invalid-input');
    store.transact(ADA, (transaction) => {
      transaction.patchObject(IMAGE, { locked: true });
    });
    expect(
      codes({ id: IMAGE, assetId: NEW_ASSET, naturalSize: { width: 100, height: 100 } }),
    ).toContain('locked');
  });
});
