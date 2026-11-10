import { describe, expect, it, vi } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource } from './fixture-asset-source.js';

describe('TextureManager image undo', () => {
  it.each([false, true])('restores a ready image immediately (lost GPU: %s)', async (isGpuLost) => {
    const fetches: number[] = [];
    const assets = createFixtureAssetSource(5, {
      beforeFetch: (request) => {
        fetches.push(request.longEdgePx ?? 0);
        return Promise.resolve();
      },
    });
    const describeAsset = vi.fn((id: Parameters<typeof assets.describe>[0]) => assets.describe(id));
    const harness = new TextureManagerHarness({ ...assets, describe: describeAsset });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1));
    const loadedFetches = fetches.length;
    expect(describeAsset).toHaveBeenCalledTimes(1);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    harness.manager.forget(image.id);
    harness.frame(cameraAt(1));
    if (isGpuLost) harness.rebuild(new FakeGpuBackend());
    harness.track(image);
    const restored = harness.frame(cameraAt(1));

    expect(restored.placeholderImages).toBe(0);
    expect(restored.blankImages).toBe(0);
    expect(harness.manager.shownKeys(image.id)).toEqual([isGpuLost ? 'photo|L128' : 'photo|L512']);
    await harness.settle(cameraAt(1));
    expect(describeAsset).toHaveBeenCalledTimes(2);
    expect(fetches.slice(loadedFetches)).toEqual(isGpuLost ? [512] : []);
    harness.manager.destroy();
    harness.catalogue.destroy();
  });
});

it.each([false, true])(
  'drops restored pixels on the first failed revalidation (lost GPU: %s)',
  async (isGpuLost) => {
    const assets = createFixtureAssetSource(5);
    let isDenied = false;
    const describeAsset = vi.fn((id: Parameters<typeof assets.describe>[0]) =>
      isDenied ? Promise.reject(new Error('forbidden')) : assets.describe(id),
    );
    const harness = new TextureManagerHarness({ ...assets, describe: describeAsset });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1));
    harness.manager.forget(image.id);
    harness.frame(cameraAt(1));
    if (isGpuLost) harness.rebuild(new FakeGpuBackend());
    isDenied = true;
    harness.track(image);
    harness.frame(cameraAt(1));
    await flushMicrotasks();
    const refused = harness.frame(cameraAt(1));
    expect(describeAsset).toHaveBeenCalledTimes(2);
    expect(harness.retries).toHaveLength(1);
    expect(harness.catalogue.peek(image.assetId)).toMatchObject({
      hasBeenReady: false,
      smallest: undefined,
      view: undefined,
      info: undefined,
      levels: [],
    });
    expect(refused).toMatchObject({ placeholderImages: 1, blankImages: 0 });
    expect(harness.manager.shownKeys(image.id)).toEqual(['placeholder']);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      harness.retries.shift()?.();
      await flushMicrotasks();
      expect(harness.frame(cameraAt(1))).toMatchObject({ placeholderImages: 1, blankImages: 0 });
    }
    expect(harness.catalogue.peek(image.assetId)?.status).toBe('failed');
    harness.manager.destroy();
    harness.catalogue.destroy();
  },
);
