import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import { pendingImageAssetInfo, type AssetSource } from './asset-source.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import { ImagePlanner } from './image-planner.js';

// What a texture manager's frame costs and what it does across frames: pans that plan nothing,
// uploads spread under the per-frame cap, faults reported once, and assets followed only while
// an image uses them.

const MIB = 1024 * 1024;
const PHOTO_SPEC = { naturalSize: { width: 4000, height: 3000 } };
/** The bytes of a 4000 × 3000 asset's 128 level: 128 × 96 RGBA. */
const SMALLEST_BYTES = 128 * 96 * 4;

/**
 * A row of images 450 world units apart, one asset each.
 *
 * @param count - How many.
 * @returns The images.
 */
function row(count: number) {
  return Array.from({ length: count }, (unused, index) =>
    imageObject({
      id: `image-${String(index)}` as ObjectId,
      assetId: fixtureAssetId(`asset-${String(index)}`),
      x: index * 450,
    }),
  );
}

function assetsFor(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (unused, index) => [`asset-${String(index)}`, PHOTO_SPEC]),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TextureManager frames', () => {
  it('plans nothing for a pan at an unchanged zoom, but counts what comes on screen', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: assetsFor(3) }),
    );
    harness.track(...row(3));
    await harness.settle(cameraAt(1, 0));
    const plan = vi.spyOn(ImagePlanner.prototype, 'plan');

    const panned = harness.frame(cameraAt(1, 100));
    const zoomed = harness.frame(cameraAt(1.2, 100));

    expect(panned).toMatchObject({ rebound: [], visibleImages: 3, blankImages: 0 });
    expect(plan).not.toHaveBeenCalled();
    expect(zoomed.visibleImages).toBe(3);
    harness.frame(cameraAt(1.5, 100));
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it('re-uploads smallest levels after a device loss over frames, under the byte cap', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: assetsFor(3) }),
      { uploadBytesPerFrame: SMALLEST_BYTES * 1.5 },
    );
    const images = row(3);
    harness.track(...images);
    await harness.settle(cameraAt(0.5));

    harness.backend.loseDevice();
    harness.rebuild(new FakeGpuBackend());
    harness.track(...images);
    const resident: number[] = [];
    for (let frame = 0; frame < 3; frame += 1) {
      harness.frame(cameraAt(0.5));
      resident.push(harness.manager.residentKeys().filter((key) => key.endsWith('L128')).length);
    }

    expect(resident).toEqual([1, 2, 3]);
    expect(harness.jobs.submitted.filter(({ longEdgesPx }) => longEdgesPx[0] === 128)).toHaveLength(
      3,
    );
  });

  it('counts and reports each load nothing could decode, the images on their placeholder', async () => {
    const faults: Error[] = [];
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: {} });
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: assetsFor(2) }),
      { jobs: pool, onDecoderMissing: (error) => faults.push(error) },
    );
    harness.track(...row(2));
    let last = harness.frame(cameraAt(0.5));
    for (let round = 0; round < 5; round += 1) {
      await flushMicrotasks();
      pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
      await flushMicrotasks();
      last = harness.frame(cameraAt(0.5));
    }

    // Each image's 128 and 512 levels.
    expect(harness.manager.stats.decoderMissingFailures).toBe(4);
    expect(faults).toHaveLength(4);
    expect(last).toMatchObject({ placeholderImages: 2, blankImages: 0 });
  });

  it('stops following an asset no image uses, and describes a failed one again', async () => {
    let describes = 0;
    let isLinked = false;
    const fixture = createFixtureAssetSource(5, { assets: assetsFor(1) });
    const source: AssetSource = {
      ...fixture,
      describe: (assetId: AssetId) => {
        describes += 1;
        return isLinked ? fixture.describe(assetId) : Promise.reject(new Error('not linked'));
      },
    };
    const harness = new TextureManagerHarness(source);
    const [image] = row(1);
    if (image === undefined) throw new Error('no image');
    harness.track(image);
    await flushMicrotasks();
    while (harness.retries.length > 0) {
      harness.retries.shift()?.();
      await flushMicrotasks();
    }
    expect(harness.catalogue.peek(image.assetId)?.status).toBe('failed');

    // A collaborator moves the image: it is seen again, now that the board can read it.
    isLinked = true;
    harness.track({ ...image, x: 10 });
    await harness.settle(cameraAt(0.5));
    expect(harness.manager.shownKeys(image.id)).toEqual(['asset-0|L512']);

    harness.manager.forget(image.id);
    harness.frame(cameraAt(0.6));

    expect(describes).toBe(6);
    expect(harness.catalogue.peek(image.assetId)).toBeUndefined();
  });

  it('moves an image to its new asset when the object changes asset', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: assetsFor(2) }),
    );
    const [image] = row(1);
    if (image === undefined) throw new Error('no image');
    harness.track(image);
    await harness.settle(cameraAt(0.5));

    harness.track({ ...image, assetId: fixtureAssetId('asset-1') });
    await harness.settle(cameraAt(0.5));

    expect(harness.manager.shownKeys(image.id)).toEqual(['asset-1|L512']);
    expect(harness.catalogue.peek(fixtureAssetId('asset-0'))).toBeUndefined();
  });

  it('evicts the levels of an image the scene removed when another needs the room', async () => {
    // The 128 atlas page (16 MiB) and one 2048 level (12 MiB) fit in 30 MiB, not two.
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: assetsFor(2) }),
      { texturesBytes: 30 * MIB, maxTextureSize: 2048 },
    );
    const [first, second] = row(2).map((image, index) => ({ ...image, x: index * 5000 }));
    if (first === undefined || second === undefined) throw new Error('no images');
    harness.track(first, second);
    await harness.settle(cameraAt(4, 0));
    expect(harness.manager.residentKeys()).toContain('asset-0|L2048');

    harness.manager.forget(first.id);
    await harness.settle(cameraAt(4, 5000));

    expect(harness.manager.residentKeys()).not.toContain('asset-0|L2048');
    expect(harness.manager.shownKeys(second.id)).toEqual(['asset-1|L2048']);
  });
});

describe('TextureManager and a pending asset', () => {
  /**
   * A source whose every asset stays pending, recording what the manager tells it.
   *
   * @returns The source and what it heard.
   */
  function pendingSource() {
    const reports: AssetId[][] = [];
    const nearReports: AssetId[][] = [];
    const revived: AssetId[] = [];
    const none = () => Promise.reject(new Error('nothing to fetch'));
    const source: AssetSource = {
      describe: () => Promise.resolve(pendingImageAssetInfo()),
      fetchLevel: none,
      fetchTile: none,
      fetchOriginal: none,
      subscribe: () => () => undefined,
      setVisibleAssets: (assetIds, nearAssetIds) => {
        reports.push([...assetIds]);
        nearReports.push([...nearAssetIds]);
      },
      revive: (assetId) => {
        revived.push(assetId);
      },
    };
    return { source, reports, nearReports, revived };
  }

  it('reports the assets the images on screen wait for, only when they change', async () => {
    const { source, reports } = pendingSource();
    const harness = new TextureManagerHarness(source);
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1));
    harness.frame(cameraAt(1));
    // Panned far away: nothing on screen waits.
    await harness.settle(cameraAt(1, 50_000, 50_000));
    expect(reports).toEqual([['photo'], []]);
  });

  it('reports the assets of images just off screen as near, and neither far away', async () => {
    const { source, reports, nearReports } = pendingSource();
    const harness = new TextureManagerHarness(source);
    harness.track(imageObject());
    // The image (0 to 400 wide) lies left of a view starting at 450, inside its padding.
    await harness.settle(cameraAt(1, 450, 0));
    await harness.settle(cameraAt(1, 50_000, 50_000));
    await harness.settle(cameraAt(1));
    expect(reports).toEqual([[], [], ['photo']]);
    expect(nearReports).toEqual([['photo'], [], []]);
  });

  it('asks the source to follow again an asset whose object changed while it is pending', async () => {
    const { source, revived } = pendingSource();
    const harness = new TextureManagerHarness(source);
    const image = imageObject();
    harness.track(image);
    await flushMicrotasks();
    expect(revived).toEqual(['photo']);
    harness.track({ ...image, x: 10 });
    expect(revived).toEqual(['photo', 'photo']);
  });
});
